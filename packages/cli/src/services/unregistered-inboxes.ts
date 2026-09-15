import {CacheService, PathBuilder} from '@workflowy/shared/cache';
import type * as schema from '@workflowy/shared/db';
import {stripHtmlTags} from '@workflowy/shared/html';
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';

export async function findUnregisteredInboxes(
	database: BetterSQLite3Database<typeof schema>,
	registeredIds: Set<string>,
): Promise<{id: string; name: string; path: string}[]> {
	// SQLite's negative limit searches the entire cache, including deep descendants.
	const matches = await new CacheService(database).searchText({query: 'Inbox', limit: -1});
	const unregistered = matches.filter((node) => {
		const name = stripHtmlTags(node.name ?? '').trim();
		return (name === 'Inbox' || name === '📥 Inbox') && !registeredIds.has(node.id);
	});
	const paths = await new PathBuilder(database).buildFullPathsBatch(unregistered.map((node) => node.id));
	return unregistered
		.map((node) => ({
			id: node.id,
			name: stripHtmlTags(node.name ?? '').trim(),
			path: paths.get(node.id) ?? '',
		}))
		.sort((left, right) => left.id.localeCompare(right.id));
}
