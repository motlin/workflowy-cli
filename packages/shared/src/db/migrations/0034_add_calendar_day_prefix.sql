-- 📅 The calendar root's `day_prefix` setting (Friendly day names: the
-- "Yesterday, / Today, / Tomorrow," title prefix). Null when the backup omits it,
-- which upstream treats as on.
ALTER TABLE calendar_metadata ADD COLUMN day_prefix INTEGER;
