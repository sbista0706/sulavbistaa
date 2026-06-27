ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS storage_path     text,
  ADD COLUMN IF NOT EXISTS property_type    text,
  ADD COLUMN IF NOT EXISTS property_subtype text,
  ADD COLUMN IF NOT EXISTS type_detected_by text DEFAULT 'ai',
  ADD COLUMN IF NOT EXISTS location         text,
  ADD COLUMN IF NOT EXISTS metrics          jsonb,
  ADD COLUMN IF NOT EXISTS type_metrics     jsonb,
  ADD COLUMN IF NOT EXISTS report_text      text,
  ADD COLUMN IF NOT EXISTS report_path      text,
  ADD COLUMN IF NOT EXISTS verify_items     jsonb,
  ADD COLUMN IF NOT EXISTS confidence       jsonb;