import type {BaseSQLiteDatabase} from "drizzle-orm/sqlite-core";

import type * as schema from "./schema.js";

/**
 * The driver-neutral synchronous Drizzle SQLite handle the shared cache code
 * and the web server depend on. Both `BetterSQLite3Database` (Node) and
 * `DrizzleSqliteDODatabase` (Cloudflare Durable Object) are assignable to it.
 */
export type AppDatabase = BaseSQLiteDatabase<"sync", unknown, typeof schema>;
