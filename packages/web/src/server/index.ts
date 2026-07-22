import {Hono} from 'hono';
import {cors} from 'hono/cors';
import {serve} from '@hono/node-server';
import {type AppEnv, createServerContext} from './context.js';
import {changesRouter} from './routes/changes.js';
import {nodesRouter} from './routes/nodes.js';
import {relatedRouter} from './routes/related.js';
import {searchRouter} from './routes/search.js';
import {tagsRouter} from './routes/tags.js';

const app = new Hono<AppEnv>();

// CORS for Vite dev server
app.use(
	'/*',
	cors({
		origin: 'http://localhost:5173',
		allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization'],
	}),
);

// Composition root: build the server context once and expose it to every router.
const serverContext = createServerContext();
app.use('/*', async (c, next) => {
	c.set('ctx', serverContext);
	await next();
});

// Mount API routes
app.route('/api/changes', changesRouter);
app.route('/api/v1/nodes', nodesRouter);
app.route('/api/v1/tags', tagsRouter);
app.route('/api/search', searchRouter);
app.route('/api/related', relatedRouter);

// Health check
app.get('/health', (c) => c.json({status: 'ok'}));

const port = 3000;
console.log(`Server running at http://127.0.0.1:${port}`);

serve({fetch: app.fetch, hostname: '127.0.0.1', port});
