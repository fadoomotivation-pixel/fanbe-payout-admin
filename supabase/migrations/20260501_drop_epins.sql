-- =============================================================
-- Migration: Drop E-Pin system
-- Date: 2026-05-01
-- Reason: E-Pin (broker self-signup codes) removed to keep the
--         admin CRM simple. Brokers are added directly by admin.
-- =============================================================

-- 1. Drop trigger first (depends on table)
DROP TRIGGER IF EXISTS trg_epins_updated_at ON bp_epins;

-- 2. Drop indexes
DROP INDEX IF EXISTS idx_epins_code;
DROP INDEX IF EXISTS idx_epins_status;

-- 3. Drop the table (CASCADE drops the RLS policy with it)
DROP TABLE IF EXISTS bp_epins CASCADE;

-- 4. Drop the auto-expire function
DROP FUNCTION IF EXISTS fn_epin_auto_expire();
