import {z} from 'zod';
import {getCacheService} from '../services.js';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';

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

			const rows = await getCacheService().searchText({query, limit});

			if (rows.length === 0) {
				return {content: [{type: 'text', text: `No results found for: ${query}`}]};
			}

			const formattedResults = rows.map((node) => ({
				id: node.id,
				name: node.name,
				note: node.note,
				completedAt: node.completedAt ? node.completedAt.toISOString() : null,
				url: `https://workflowy.com/#/${node.id.replaceAll('-', '')}`,
			}));

			return {content: [{type: 'text', text: JSON.stringify(formattedResults, null, 2)}]};
		},
	);
}
