import {getDatabase} from "../services.js";
import {sql} from "drizzle-orm";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerCacheTools(server: McpServer): void {
	server.registerTool(
		"workflowy_cache_status",
		{description: "Get cache database status and statistics", inputSchema: {}},
		() => {
			const db = getDatabase();

			const result = db.get<{
				total_nodes: number;
				completed_nodes: number;
				metadata_count: number;
				last_sync: number | null;
			}>(sql`
			SELECT
				(SELECT COUNT(*) FROM node_content WHERE system_to = 253402300799) as total_nodes,
				(SELECT COUNT(*) FROM node_content WHERE system_to = 253402300799 AND is_completed = 1) as completed_nodes,
				(SELECT COUNT(*) FROM node_metadata) as metadata_count,
				(SELECT MAX(last_updated) FROM cache_state) as last_sync
		`);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								totalNodes: result.total_nodes,
								completedNodes: result.completed_nodes,
								metadataCount: result.metadata_count,
								lastSync:
									result.last_sync === null || result.last_sync === 0
										? null
										: new Date(result.last_sync * 1000).toISOString(),
							},
							null,
							2,
						),
					},
				],
			};
		},
	);
}
