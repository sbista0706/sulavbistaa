-- Secure the `analyses` table: replace the permissive "anyone can do anything"
-- RLS policies with per-row ownership scoped to the authenticated user.
--
-- Background: the initial migration granted SELECT/INSERT/UPDATE to the public
-- role with USING (true) / WITH CHECK (true), so any anonymous visitor could
-- read, overwrite, and corrupt every other user's analyses (file_name,
-- extracted_data, risk_results, recommendation). This migration adds an owner
-- column and scopes all access to auth.uid() = user_id.
--
-- The app uses Supabase anonymous auth (no login UI), so each browser still
-- gets a real auth.uid(); upgrading to email/OAuth later needs no policy change.

-- 1. Ownership column ---------------------------------------------------------
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid()
    REFERENCES auth.users (id) ON DELETE CASCADE;

-- Legacy rows have no owner and were the globally-readable leak; drop them so
-- we can enforce NOT NULL and they stop being visible to everyone.
DELETE FROM public.analyses WHERE user_id IS NULL;

ALTER TABLE public.analyses ALTER COLUMN user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS analyses_user_id_idx ON public.analyses (user_id);

-- 2. Remove the permissive policies ------------------------------------------
DROP POLICY IF EXISTS "Anyone can view analyses"   ON public.analyses;
DROP POLICY IF EXISTS "Anyone can insert analyses" ON public.analyses;
DROP POLICY IF EXISTS "Anyone can update analyses" ON public.analyses;

-- 3. Lock out logged-out (anon role) direct table access ----------------------
-- All access now flows through an authenticated session (incl. anonymous auth).
REVOKE SELECT, INSERT, UPDATE ON public.analyses FROM anon;

-- 4. Owner-scoped policies ----------------------------------------------------
DROP POLICY IF EXISTS "Owners can view their analyses" ON public.analyses;
CREATE POLICY "Owners can view their analyses"
  ON public.analyses
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Owners can insert their analyses" ON public.analyses;
CREATE POLICY "Owners can insert their analyses"
  ON public.analyses
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Owners can update their analyses" ON public.analyses;
CREATE POLICY "Owners can update their analyses"
  ON public.analyses
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
