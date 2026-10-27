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
		return super.fetch(request);
	}
}

export default worker;
