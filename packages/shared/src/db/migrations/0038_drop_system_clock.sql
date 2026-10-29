-- System times come from the application's UTC clock, read once per unit of
-- work, not from a database clock, so the single-row system_clock is gone.
DROP TABLE IF EXISTS system_clock;
