import {z} from "zod";
import {ChangeDetector, parseSince} from "@workflowy/shared/changes";
import {defineOp, fail, jsonOf, ok} from "./define.js";

/** Changes since a relative or absolute cutoff (default one day), detected from the temporal tables. */
export const changesList = defineOp({
	input: z.object({since: z.string().default("1d")}),
	run(ctx, {since}) {
		let cutoffDate: Date;
		try {
			cutoffDate = parseSince(since);
		} catch {
			return fail(400, {error: `Invalid since parameter: "${since}"`});
		}
		const result = new ChangeDetector(ctx.db).detectChanges(cutoffDate);
		return ok(
			jsonOf({
				changes: result.changes,
				tree: result.tree,
				summary: result.summary,
				cutoffDate: result.cutoffDate.toISOString(),
			}),
		);
	},
});
