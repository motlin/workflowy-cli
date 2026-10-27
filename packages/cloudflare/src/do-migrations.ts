import {journal, migrations} from "@workflowy/shared/db-migrations-bundle";

/**
 * Migration 0029 seeds `system_clock` from a 13-way `UNION ALL`, which exceeds
 * Durable Object SQLite's compound-SELECT term limit. A new Durable Object has
 * no rows to seed from, so it creates the table and seeds the clock at zero,
 * which is exactly what the original statement computes over empty tables.
 */
const systemClockMigration = `CREATE TABLE IF NOT EXISTS system_clock (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_ms INTEGER NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO system_clock (id, last_ms) VALUES (1, 0);
`;

export const doMigrationConfig = {
	// Drizzle's migrator wants a mutable journal; the bundle is `as const`.
	journal: {entries: journal.entries.map((entry) => ({...entry}))},
	migrations: {...migrations, m0029: systemClockMigration},
};
