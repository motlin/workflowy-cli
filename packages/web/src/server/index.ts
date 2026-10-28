import {serve} from "@hono/node-server";
import {createNodeWebSocket} from "@hono/node-ws";
import {createApp} from "./app.js";
import {createHttpRoutes} from "./http/app.js";
import {inProcessStore} from "./store.js";
import {httpLoggingEnabled, loggingFetch} from "./http-logger.js";
import {createServerContext} from "./node-context.js";
import {ladderSocketHandlers} from "./ladder-socket.js";
import {resolvePort} from "./port.js";
import {warmTreeSnapshot} from "./tree-snapshot.js";

process.title = "workflowy-web-server";

if (httpLoggingEnabled(process.env)) {
	globalThis.fetch = loggingFetch(globalThis.fetch, (line) => {
		console.log(line);
	});
}

// Composition root: build the server context once and expose it to every router.
const serverContext = createServerContext();
const store = inProcessStore(serverContext);
const app = createApp(serverContext, {
	corsOrigin: "http://localhost:5173",
	httpRoutes: createHttpRoutes(() => store),
});

/**
 * Every ladder write, streamed as one frame per write. Monitor's `ws:` source
 * turns each frame into a notification, so a Claude session watching this URL
 * is woken by an edit instead of having to poll for one.
 */
const nodeWebSocket = createNodeWebSocket({app});
app.get(
	"/api/v1/ladder/events",
	nodeWebSocket.upgradeWebSocket(() => ladderSocketHandlers(serverContext.ladderEvents)),
);

const port = resolvePort(process.env);

// Logged from the listening callback, so a port clash reports EADDRINUSE
// instead of a "Server running" line that was never true.
const server = serve({fetch: app.fetch, hostname: "127.0.0.1", port}, (info) => {
	console.log(`Server running at http://127.0.0.1:${info.port}`);
	// After listening, so the first search/switcher request finds the whole-tree snapshot already built.
	setImmediate(() => {
		warmTreeSnapshot(serverContext.db);
	});
});
nodeWebSocket.injectWebSocket(server);
