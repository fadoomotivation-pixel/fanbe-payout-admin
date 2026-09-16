-- Follow-up to 20260916_close_anonymous_database_access.sql.
--
-- Six policies ask "is the caller an admin?" by reading public.profiles, and they were
-- attached to PUBLIC — so an anonymous request evaluated them too.  Once anon lost
-- table-level SELECT on profiles, those evaluations started raising
--
--     permission denied for table profiles
--
-- instead of simply returning no rows.  The access decision was already correct (an
-- anonymous caller can never satisfy the check); only the failure mode was wrong, and a
-- hard error is a worse answer than an empty result.
--
-- Scoping them to `authenticated` takes nothing away: an anonymous visitor is never an
-- admin, so the check is now skipped for someone who could never pass it.

DROP POLICY IF EXISTS admin_manage_all_attendance ON public.attendance;
CREATE POLICY admin_manage_all_attendance ON public.attendance
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = auth.uid()
                    AND p.role = ANY (ARRAY['super_admin'::app_role,'sub_admin'::app_role,'sales_manager'::app_role,'manager'::app_role])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = auth.uid()
                    AND p.role = ANY (ARRAY['super_admin'::app_role,'sub_admin'::app_role,'sales_manager'::app_role,'manager'::app_role])));

DROP POLICY IF EXISTS admin_read_all_attendance ON public.attendance;
CREATE POLICY admin_read_all_attendance ON public.attendance
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = auth.uid()
                    AND p.role = ANY (ARRAY['super_admin'::app_role,'sub_admin'::app_role,'sales_manager'::app_role,'manager'::app_role])));

DROP POLICY IF EXISTS "Admins can update all bookings" ON public.bookings;
CREATE POLICY "Admins can update all bookings" ON public.bookings
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles
                  WHERE profiles.id = auth.uid()
                    AND profiles.role = ANY (ARRAY['super_admin'::app_role,'manager'::app_role])));

DROP POLICY IF EXISTS "Admins can view all bookings" ON public.bookings;
CREATE POLICY "Admins can view all bookings" ON public.bookings
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles
                  WHERE profiles.id = auth.uid()
                    AND profiles.role = ANY (ARRAY['super_admin'::app_role,'manager'::app_role,'sub_admin'::app_role])));

DROP POLICY IF EXISTS "Admins can view all calls" ON public.calls;
CREATE POLICY "Admins can view all calls" ON public.calls
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles
                  WHERE profiles.id = auth.uid()
                    AND profiles.role = ANY (ARRAY['super_admin'::app_role,'manager'::app_role,'sub_admin'::app_role])));

DROP POLICY IF EXISTS "Admins can view all site visits" ON public.site_visits;
CREATE POLICY "Admins can view all site visits" ON public.site_visits
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles
                  WHERE profiles.id = auth.uid()
                    AND profiles.role = ANY (ARRAY['super_admin'::app_role,'manager'::app_role,'sub_admin'::app_role])));
