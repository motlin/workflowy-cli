import {CacheService} from "@workflowy/shared/cache";
import * as dbSchema from "@workflowy/shared/db";
import {drizzle} from "drizzle-orm/durable-sqlite";
import {UserStore} from "../src/user-store";
import worker from "../src/worker";

/** Test-only subclass exposing the DO's raw SQLite state. */
export class ProbeStore extends UserStore {
	override async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/__probe") {
			const names = this.ctx.storage.sql
				.exec("SELECT name FROM sqlite_master ORDER BY name")
				.toArray()
				.flatMap((row) => (typeof row.name === "string" ? [row.name] : []));
			const schema = this.ctx.storage.sql
				.exec("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name")
				.toArray();
			const migrations = Number(
				this.ctx.storage.sql.exec("SELECT count(*) AS n FROM __drizzle_migrations").one().n,
			);
			return Response.json({names, schema, migrations, appliedOnBoot: this.appliedOnBoot});
		}
		if (url.pathname === "/__session") {
			const write = url.searchParams.get("write");
			if (write !== null) {
				this.sessionStore.write(write);
			}
			return Response.json({cookie: this.sessionStore.read() ?? null});
		}
		if (url.pathname === "/__publish") {
			this.ladderEvents.publish({
				verb: "move",
				nodeId: "node-1",
				name: "Write the report",
				fromTier: "3",
				toTier: "1",
				at: "2026-10-27T00:00:00.000Z",
			});
			return Response.json({ok: true});
		}
		if (url.pathname === "/__seed") {
			new CacheService(drizzle(this.ctx.storage, {schema: dbSchema})).insertNode(
				{
					id: "seed-node",
					name: "seeded",
					note: null,
					parent_id: null,
					priority: 100,
					createdAt: 1,
					modifiedAt: 1,
				},
				null,
			);
			return Response.json({ok: true});
		}
		return super.fetch(request);
	}
}

export default worker;
