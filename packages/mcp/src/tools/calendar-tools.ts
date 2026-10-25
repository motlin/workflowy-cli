import {findCalendarDay} from "@workflowy/shared/calendar-lookup";
import {CALENDAR_LEVELS} from "@workflowy/shared/internal";
import {z} from "zod";
import {getCacheService, getDatabase, getInternalAdapter} from "../services.js";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";

const NO_AUTH =
	"Calendar day ensure needs internal API auth (WORKFLOWY_USERNAME/WORKFLOWY_PASSWORD or a saved session)";

function textResult(text: string, isError = false) {
	return {content: [{type: "text" as const, text}], ...(isError ? {isError: true} : {})};
}

export function registerCalendarTools(server: McpServer): void {
	server.registerTool(
		"workflowy_calendar_day",
		{
			description:
				"Find the 📆 Calendar day node workflowy.com uses for a date (strict metadata.calendar walk), or with ensure create it, and any missing year/month, with calendar metadata. Always use this instead of creating date nodes by name under the 📆 Calendar.",
			inputSchema: {
				date: z.string().describe("Date as YYYY-MM-DD"),
				ensure: z.boolean().optional().describe("Create the node when it is missing (needs internal API auth)"),
				level: z.enum(CALENDAR_LEVELS).optional().describe("Which node: day (default), week, month or year"),
				createChild: z
					.boolean()
					.optional()
					.describe("With ensure, add an empty first child to a new or empty node (default true)"),
			},
		},
		async ({date, ensure, level, createChild}) => {
			const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
			if (match === null) {
				return textResult(`Invalid date "${date}". Use YYYY-MM-DD.`, true);
			}
			const dateId = Number(match[1]) * 10_000 + Number(match[2]) * 100 + Number(match[3]);
			const stopAt = level ?? "day";
			const cache = getCacheService();
			const found = findCalendarDay({db: getDatabase(), cache}, dateId, stopAt);
			if (found !== null) {
				const firstChildId = cache.getChildren(found)[0]?.id ?? null;
				return textResult(JSON.stringify({id: found, created: false, firstChildId}, null, 2));
			}
			if (!ensure) {
				return textResult(`No 📆 Calendar ${stopAt} for ${date} (pass ensure: true)`, true);
			}
			const adapter = getInternalAdapter();
			if (adapter === undefined) {
				return textResult(NO_AUTH, true);
			}
			const ensured = await adapter.ensureCalendarDay(dateId, {stopAt, createChild: createChild ?? true});
			return textResult(
				JSON.stringify(
					{id: ensured.dayId, created: ensured.created.length > 0, firstChildId: ensured.firstChildId},
					null,
					2,
				),
			);
		},
	);
}
