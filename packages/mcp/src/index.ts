import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {registerNodeTools} from './tools/node-tools.js';
import {registerCacheTools} from './tools/cache-tools.js';
import {registerSearchTools} from './tools/search-tools.js';

const server = new McpServer({
	name: 'workflowy',
	version: '0.1.0',
});

registerNodeTools(server);
registerCacheTools(server);
registerSearchTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
