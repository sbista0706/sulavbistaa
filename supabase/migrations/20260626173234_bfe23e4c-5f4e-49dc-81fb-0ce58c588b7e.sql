
CREATE TABLE IF NOT EXISTS public.analyses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  file_name TEXT NOT NULL,
  property_name TEXT,
  status TEXT NOT NULL DEFAULT 'processing',
  extracted_data JSONB,
  risk_results JSONB,
  recommendation TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.analyses TO anon, authenticated;
GRANT ALL ON public.analyses TO service_role;

ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view analyses" ON public.analyses;
CREATE POLICY "Anyone can view analyses" ON public.analyses FOR SELECT USING (true);
DROP POLICY IF EXISTS "Anyone can insert analyses" ON public.analyses;
CREATE POLICY "Anyone can insert analyses" ON public.analyses FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Anyone can update analyses" ON public.analyses;
CREATE POLICY "Anyone can update analyses" ON public.analyses FOR UPDATE USING (true);
