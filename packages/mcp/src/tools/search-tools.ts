import {z} from 'zod';
import {getDatabase} from '../services.js';
import {sql} from 'drizzle-orm';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';

interface SearchResult {
	id: string;
	name: string;
	note: string | null;
	completed_at: number | null;
}

export function registerSearchTools(server: McpServer): void {
	server.tool(
		'workflowy_search',
		'Search for nodes by text query',
		{
			query: z.string().describe('Text to search for in node names and notes'),
			limit: z.number().optional().default(20).describe('Maximum number of results to return'),
		},
		async ({query, limit}) => {
			if (!query.trim()) {
				return {content: [{type: 'text', text: 'Query cannot be empty'}], isError: true};
			}

			const db = getDatabase();

			const searchPattern = `%${query}%`;
			const results = db.all(sql`
				SELECT
					nc.id,
					nc.name,
					nc.note,
					nm.completed_at
				FROM node_content nc
				LEFT JOIN node_metadata nm ON nc.id = nm.id
				WHERE nc.system_to = 253402300799
					AND (nc.name LIKE ${searchPattern} OR nc.note LIKE ${searchPattern})
				LIMIT ${limit}
			`) as SearchResult[];

			if (results.length === 0) {
				return {content: [{type: 'text', text: `No results found for: ${query}`}]};
			}

			const formattedResults = results.map((node) => ({
				id: node.id,
				name: node.name,
				note: node.note,
				completedAt: node.completed_at ? new Date(node.completed_at * 1000).toISOString() : null,
				url: `https://workflowy.com/#/${node.id.replaceAll('-', '')}`,
			}));

			return {content: [{type: 'text', text: JSON.stringify(formattedResults, null, 2)}]};
		},
	);
}
