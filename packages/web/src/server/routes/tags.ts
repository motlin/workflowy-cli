import {Hono} from 'hono';
import {tags} from '@workflowy/shared/db';
import {eq} from 'drizzle-orm';
import {getDatabase} from '../db.js';

export const tagsRouter = new Hono();

// Workflowy's tag color palette. Assignments outside this set are rejected.
const VALID_COLORS = new Set(['red', 'orange', 'yellow', 'green', 'teal', 'sky', 'blue', 'purple', 'pink', 'gray']);

interface TagColorBody {
	color?: string;
}

// GET /api/v1/tags - all tag color assignments as {name: color}
tagsRouter.get('/', (c) => {
	const database = getDatabase();
	const rows = database.select({name: tags.name, color: tags.color}).from(tags).all();
	const colors: Record<string, string> = {};
	for (const row of rows) {
		colors[row.name] = row.color;
	}
	return c.json({colors});
});

// PUT /api/v1/tags/:name - set the color for a tag (upsert)
tagsRouter.put('/:name', async (c) => {
	const name = c.req.param('name');
	const body = (await c.req.json()) as TagColorBody;
	const color = body.color;

	if (!color || !VALID_COLORS.has(color)) {
		return c.json({error: `Invalid color: ${color ?? '(missing)'}`}, 400);
	}

	const database = getDatabase();
	const now = new Date().toISOString();
	database
		.insert(tags)
		.values({name, color, createdAt: now, updatedAt: now})
		.onConflictDoUpdate({target: tags.name, set: {color, updatedAt: now}})
		.run();

	return c.json({name, color});
});

// DELETE /api/v1/tags/:name - clear the color for a tag
tagsRouter.delete('/:name', (c) => {
	const name = c.req.param('name');
	const database = getDatabase();
	database.delete(tags).where(eq(tags.name, name)).run();
	return c.json({name});
});
