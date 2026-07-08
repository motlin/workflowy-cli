import {Hono} from 'hono';
import {ChangeDetector, parseSince} from '@workflowy/shared/changes';
import {getDatabase} from '../db.js';

export const changesRouter = new Hono();

changesRouter.get('/', (c) => {
	const since = c.req.query('since') ?? '1d';

	let cutoffDate: Date;
	try {
		cutoffDate = parseSince(since);
	} catch {
		return c.json({error: `Invalid since parameter: "${since}"`}, 400);
	}

	const database = getDatabase();
	const detector = new ChangeDetector(database);
	const result = detector.detectChanges(cutoffDate);

	return c.json({
		changes: result.changes,
		tree: result.tree,
		summary: result.summary,
		cutoffDate: result.cutoffDate.toISOString(),
	});
});
