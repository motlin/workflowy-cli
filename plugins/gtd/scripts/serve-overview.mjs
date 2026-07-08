#!/usr/bin/env node
// Serve the morning overview as an interactive page and capture what the user checks off.
//
// The daily review's morning overview is more useful as a browser page with
// checkboxes than as console text: the user ticks the items they've done and the
// review applies the completions. This server takes a static overview HTML file
// (actionable rows carry <input type="checkbox" data-id=… data-source=… data-label=…>),
// injects the client wiring + a Done button, and records every change to a JSON
// file. On Done it flips `submitted`, which the overview command polls for before
// applying completions (node complete for workflowy rows, osascript for reminders).
//
// Usage:
//   node serve-overview.mjs --html <overview.html> [--out .llm/gtd/review/overview-checks.json] [--port 7842]
//
// Prints "OVERVIEW_URL http://127.0.0.1:<port>/" on startup.

import {createServer as createHttpServer} from 'node:http';
import {readFileSync, writeFileSync} from 'node:fs';

const CLIENT = `
<div id="overview-actions" style="position:sticky;bottom:0;padding:12px;background:#111;color:#fff;text-align:center">
  <button id="overview-done" style="font-size:16px;padding:8px 20px;cursor:pointer">✓ Done — apply checked items</button>
  <span id="overview-status" style="margin-left:12px;opacity:.8"></span>
</div>
<script>
(function () {
  var base = location.origin;
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!el || el.type !== 'checkbox' || !el.dataset.id) return;
    fetch(base + '/check', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        id: el.dataset.id,
        source: el.dataset.source || 'workflowy',
        label: el.dataset.label || el.dataset.id,
        checked: el.checked,
      }),
    });
  });
  var done = document.getElementById('overview-done');
  done.addEventListener('click', function () {
    fetch(base + '/done', {method: 'POST'}).then(function () {
      document.getElementById('overview-status').textContent = 'Submitted — you can close this tab.';
      done.disabled = true;
    });
  });
})();
</script>
`;

export function injectClient(html) {
	return html.includes('</body>') ? html.replace('</body>', `${CLIENT}</body>`) : html + CLIENT;
}

export function applyCheck(state, payload) {
	const checks = state.checks.slice();
	const i = checks.findIndex((c) => c.id === payload.id);
	const row = {
		id: payload.id,
		source: payload.source ?? 'workflowy',
		label: payload.label ?? payload.id,
		checked: !!payload.checked,
	};
	if (i === -1) checks.push(row);
	else checks[i] = row;
	return {...state, checks};
}

function readState(outPath) {
	try {
		return JSON.parse(readFileSync(outPath, 'utf8'));
	} catch {
		return {submitted: false, checks: []};
	}
}

function writeState(outPath, state) {
	writeFileSync(outPath, JSON.stringify(state, null, 2) + '\n');
}

function readBody(req) {
	return new Promise((resolve) => {
		let data = '';
		req.on('data', (chunk) => {
			data += chunk;
		});
		req.on('end', () => resolve(data));
	});
}

export function startServer({htmlPath, outPath, port = 0}) {
	// Start each run from a clean result file so a poller reads a fresh state.
	writeState(outPath, {submitted: false, checks: []});

	const server = createHttpServer(async (req, res) => {
		if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
			const html = injectClient(readFileSync(htmlPath, 'utf8'));
			res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
			res.end(html);
			return;
		}
		if (req.method === 'POST' && req.url === '/check') {
			const payload = JSON.parse((await readBody(req)) || '{}');
			writeState(outPath, applyCheck(readState(outPath), payload));
			res.writeHead(204);
			res.end();
			return;
		}
		if (req.method === 'POST' && req.url === '/done') {
			writeState(outPath, {...readState(outPath), submitted: true});
			res.writeHead(200, {'content-type': 'application/json'});
			res.end('{"ok":true}');
			return;
		}
		res.writeHead(404);
		res.end();
	});

	return new Promise((resolve) => {
		server.listen(port, '127.0.0.1', () => {
			resolve({
				server,
				port: server.address().port,
				close: () => new Promise((r) => server.close(r)),
			});
		});
	});
}

async function main(argv) {
	const args = argv.slice(2);
	let htmlPath = null;
	let outPath = '.llm/gtd/review/overview-checks.json';
	let port = 7842;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--html') htmlPath = args[++i];
		else if (args[i] === '--out') outPath = args[++i];
		else if (args[i] === '--port') port = Number(args[++i]);
	}
	if (!htmlPath) {
		process.stderr.write('serve-overview.mjs: --html <path> is required\n');
		process.exit(2);
	}
	const {port: actual} = await startServer({htmlPath, outPath, port});
	process.stdout.write(`OVERVIEW_URL http://127.0.0.1:${actual}/\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) void main(process.argv);
