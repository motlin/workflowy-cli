import {Command, Flags} from "@oclif/core";
import {localSettings} from "@workflowy/shared/db";
import {createDatabase} from "../../db/index.js";

export interface SeedLocalSettingsResult {
	rows: number;
	upserted: number;
}

export default class SeedLocalSettings extends Command {
	static override enableJsonFlag = true;

	static override description =
		"Read the local_settings rows from the local cache (read-only) and PUT them to /api/admin/local-settings under the given Worker URL, seeding a Cloudflare deployment";

	static override examples = ["<%= config.bin %> cache:seed-local-settings --url http://localhost:8787"];

	static override flags = {
		url: Flags.string({description: "Worker base URL to seed", required: true}),
	};

	public async run(): Promise<SeedLocalSettingsResult> {
		const {flags} = await this.parse(SeedLocalSettings);
		const rows = createDatabase()
			.select()
			.from(localSettings)
			.orderBy(localSettings.key)
			.all()
			.map(({key, json, updatedAt}) => ({key, json, updatedAt}));

		const response = await fetch(new URL("/api/admin/local-settings", flags.url), {
			method: "PUT",
			headers: {"content-type": "application/json"},
			body: JSON.stringify(rows),
		});
		if (!response.ok) {
			this.error(`Seeding failed: ${response.status} ${await response.text()}`);
		}
		const body: unknown = await response.json();
		const upserted =
			typeof body === "object" && body !== null && "upserted" in body && typeof body.upserted === "number"
				? body.upserted
				: 0;
		this.log(`Seeded ${upserted} of ${rows.length} local settings to ${flags.url}`);
		return {rows: rows.length, upserted};
	}
}
