-- Phase 1: multi-type CRE screening foundation.
--   * extend `analyses` for the async n8n pipeline + universal/per-type metrics
--   * add per-user editable risk thresholds (`risk_settings`)
--   * create owner-scoped Storage buckets for OM uploads and generated reports
--
-- Architecture: the app is a thin skin. It uploads the OM to Storage, inserts a
-- `pending` row, and pings n8n. n8n (service_role) extracts metrics, scores risk,
-- writes results back, and flips status. The UI follows via Supabase Realtime.

-- 1. Extend analyses ----------------------------------------------------------
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS storage_path     text,        -- oms/{user_id}/{id}/{file}
  ADD COLUMN IF NOT EXISTS property_type    text,        -- family: residential_income | hospitality | commercial_leased | industrial_mixed
  ADD COLUMN IF NOT EXISTS property_subtype text,        -- multifamily | sfr | hotel | office | retail | industrial | mixed_use
  ADD COLUMN IF NOT EXISTS type_detected_by text DEFAULT 'ai',  -- ai | user
  ADD COLUMN IF NOT EXISTS location         text,
  ADD COLUMN IF NOT EXISTS metrics          jsonb,       -- universal core metrics
  ADD COLUMN IF NOT EXISTS type_metrics     jsonb,       -- per-type extension metrics
  ADD COLUMN IF NOT EXISTS report_text      text,        -- agent report (markdown)
  ADD COLUMN IF NOT EXISTS report_path      text,        -- reports/{user_id}/{id}/report.pdf
  ADD COLUMN IF NOT EXISTS verify_items     jsonb,       -- [{field, reason}] for human review
  ADD COLUMN IF NOT EXISTS confidence       jsonb,       -- per-field extraction confidence
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz NOT NULL DEFAULT now();

-- status vocabulary used by app + n8n: pending | processing | complete | excluded | failed
-- (kept as free text so existing rows don't break; the app enforces the set).

-- keep updated_at current on every write (Realtime + sorting rely on it)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS analyses_set_updated_at ON public.analyses;
CREATE TRIGGER analyses_set_updated_at
  BEFORE UPDATE ON public.analyses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Per-user editable risk thresholds ---------------------------------------
CREATE TABLE IF NOT EXISTS public.risk_settings (
  user_id       uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  property_type text NOT NULL,                    -- family key
  thresholds    jsonb NOT NULL,                   -- { ruleId: { ...editable params } }
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, property_type)
);

ALTER TABLE public.risk_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.risk_settings TO authenticated;

DROP POLICY IF EXISTS "Owners manage their risk settings" ON public.risk_settings;
CREATE POLICY "Owners manage their risk settings"
  ON public.risk_settings
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS risk_settings_set_updated_at ON public.risk_settings;
CREATE TRIGGER risk_settings_set_updated_at
  BEFORE UPDATE ON public.risk_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Storage buckets (private; owner-scoped) ---------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('oms', 'oms', false), ('reports', 'reports', false)
ON CONFLICT (id) DO NOTHING;

-- Path convention enforced by RLS: {bucket}/{user_id}/{analysis_id}/{filename}
-- so the first path segment must equal the caller's uid.
DROP POLICY IF EXISTS "Owners read their files" ON storage.objects;
CREATE POLICY "Owners read their files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('oms', 'reports') AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Owners upload their files" ON storage.objects;
CREATE POLICY "Owners upload their files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('oms', 'reports') AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Owners update their files" ON storage.objects;
CREATE POLICY "Owners update their files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('oms', 'reports') AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Owners delete their files" ON storage.objects;
CREATE POLICY "Owners delete their files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('oms', 'reports') AND (storage.foldername(name))[1] = auth.uid()::text);

-- 4. Realtime: let the app follow status pending -> processing -> complete -----
-- Idempotent: only add the table to the publication if it isn't already there.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'analyses'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.analyses;
  END IF;
END $$;
