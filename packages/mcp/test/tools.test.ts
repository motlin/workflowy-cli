import {describe, expect, it} from "vite-plus/test";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {registerCacheTools} from "../src/tools/cache-tools.js";
import {registerNodeTools} from "../src/tools/node-tools.js";
import {registerSearchTools} from "../src/tools/search-tools.js";

async function connectClient(): Promise<Client> {
	const server = new McpServer({name: "workflowy", version: "0.1.0"});
	registerNodeTools(server);
	registerCacheTools(server);
	registerSearchTools(server);

	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({name: "test", version: "0.0.0"});
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	return client;
}

describe("MCP tools", () => {
	it("advertises every tool with its name, description and input schema", async () => {
		const client = await connectClient();
		try {
			const {tools} = await client.listTools();
			expect(tools).toMatchSnapshot();
		} finally {
			await client.close();
		}
	});

	it("parses tool arguments before invoking the handler", async () => {
		const client = await connectClient();
		try {
			const result = await client.callTool({name: "workflowy_search", arguments: {query: "   "}});
			expect(result).toStrictEqual({content: [{type: "text", text: "Query cannot be empty"}], isError: true});
		} finally {
			await client.close();
		}
	});
});
