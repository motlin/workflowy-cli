import {findCalendarDay} from "@workflowy/shared/calendar-lookup";
import {Command, Flags} from "@oclif/core";
import {createDatabase} from "../../db/index.js";
import {CacheService} from "../../services/cache.js";
import {isoDateId} from "../../services/journal-existing-entries.js";

function todayIso(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export default class CalendarDay extends Command {
	static override description =
		"Find the 📆 Calendar day node workflowy.com uses for a date (a strict metadata.calendar walk from the root)";

	static override examples = [
		"<%= config.bin %> <%= command.id %>",
		"<%= config.bin %> <%= command.id %> --date 2026-10-05 --json",
	];

	static override flags = {
		date: Flags.string({description: "Date as YYYY-MM-DD (default: today, local time)"}),
		json: Flags.boolean({char: "j", description: "Output {id, firstChildId} as JSON", default: false}),
	};

	public async run(): Promise<{id: string; firstChildId: string | null}> {
		const {flags} = await this.parse(CalendarDay);
		const date = flags.date ?? todayIso();
		const dateId = isoDateId(date);
		if (dateId === undefined) {
			this.error(`Invalid --date "${date}". Use YYYY-MM-DD.`, {exit: 1});
		}

		const database = createDatabase();
		const cache = new CacheService(database);
		const id = findCalendarDay({db: database, cache}, dateId);
		if (id === null) {
			this.error(`No 📆 Calendar day for ${date}`, {exit: 1});
		}
		const firstChildId = cache.getChildren(id)[0]?.id ?? null;
		const result = {id, firstChildId};
		if (flags.json) {
			this.log(JSON.stringify(result));
		} else {
			this.log(id);
		}
		return result;
	}
}
