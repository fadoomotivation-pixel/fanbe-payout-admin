-- Website enquiries, visible to the payout office — and nothing else from the CRM.
--
-- Admin: "jo www.fanbegroup.com pr website pr lead enquiry h vo FANBE payout admin pr
-- show ho jae."
--
-- The enquiries already land in public.leads: the website calls submit_website_lead(),
-- which writes a row with source 'WhatsApp' (its default) or 'Website' and puts the whole
-- enquiry into notes.  The problem is who may read it.  That table belongs to the
-- call-centre CRM and its policy is
--
--     is_super_admin() OR is_sales_manager() OR assigned_to = auth.uid()
--
-- so only the one super-admin login sees everything; every other office login — including
-- `payout`, which has no CRM role at all — sees nothing.  The new FANBE Leads page was
-- therefore empty for almost everyone.
--
-- Relaxing that policy is the wrong fix: it would hand all 6,000-odd Facebook, Instagram
-- and manually-added leads to every payout user.  Instead this function hands back ONLY
-- the website enquiries, and only to payout staff.
--
--   * SECURITY DEFINER so it can read past the CRM's policy.
--   * public.is_staff() inside, so a broker login gets nothing — a broker calling this RPC
--     directly gets an empty set, not the lead book.
--   * The WHERE clause is the whole protection: no filter is taken from the caller, so
--     there is no argument anyone can pass to widen it to other leads.
--   * Read only.  Calling, assigning and follow-ups stay in the CRM, so the two systems
--     never disagree about the same lead.
--
-- Safe to run more than once.  Deletes nothing.  Changes no table, policy or row.

BEGIN;

CREATE OR REPLACE FUNCTION public.fanbe_website_leads()
RETURNS TABLE (
  id               uuid,
  name             text,
  full_name        text,
  phone            text,
  email            text,
  source           text,
  status           text,
  final_status     text,
  interest_level   text,
  project          text,
  notes            text,
  created_at       timestamptz,
  assigned_to_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT l.id, l.name, l.full_name, l.phone, l.email, l.source, l.status, l.final_status,
         l.interest_level, l.project, l.notes, l.created_at, l.assigned_to_name
    FROM public.leads l
   WHERE public.is_staff()
     AND (
       -- Two ways in, because submit_website_lead() defaults the source to 'WhatsApp' and
       -- only later rows say 'Website'.  The note check catches anything whose source was
       -- renamed on the site, so the page cannot quietly empty itself.
       l.source IN ('WhatsApp', 'Website')
       OR coalesce(l.notes, '') ILIKE '%from website%'
     )
   ORDER BY l.created_at DESC
$fn$;

REVOKE EXECUTE ON FUNCTION public.fanbe_website_leads() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fanbe_website_leads() TO authenticated;

COMMIT;

-- After running:
--
--   SELECT count(*) FROM public.fanbe_website_leads();
--   -- expect: the website enquiries only (52 on 11 Oct 2026), NOT the ~6,000 ad leads.
--
--   SELECT has_function_privilege('anon','public.fanbe_website_leads()','execute');
--   -- expect: false
