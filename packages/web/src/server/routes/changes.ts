import {Hono} from "hono";
import {ChangeDetector, parseSince} from "@workflowy/shared/changes";
import type {AppEnv} from "../context.js";

export const changesRouter = new Hono<AppEnv>();

changesRouter.get("/", (c) => {
	const since = c.req.query("since") ?? "1d";

	let cutoffDate: Date;
	try {
		cutoffDate = parseSince(since);
	} catch {
		return c.json({error: `Invalid since parameter: "${since}"`}, 400);
	}

	const database = c.get("ctx").db;
	const detector = new ChangeDetector(database);
	const result = detector.detectChanges(cutoffDate);

	return c.json({
		changes: result.changes,
		tree: result.tree,
		summary: result.summary,
		cutoffDate: result.cutoffDate.toISOString(),
	});
});
