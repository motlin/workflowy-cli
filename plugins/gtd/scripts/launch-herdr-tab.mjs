#!/usr/bin/env node
// Open a labelled herdr tab immediately right of the caller's tab and run a command in it.
// Usage: launch-herdr-tab.mjs --label <label> [--cwd <dir>] [--no-focus] -- <command...>
// `herdr tab create` always appends the tab last and the CLI has no move command, so the
// reposition goes through the socket API's `tab.move` request.
import {execFileSync} from 'node:child_process';
import {createConnection} from 'node:net';
import {homedir} from 'node:os';

export function parseArgs(argv) {
	const separator = argv.indexOf('--');
	const options = separator === -1 ? argv : argv.slice(0, separator);
	const command = separator === -1 ? [] : argv.slice(separator + 1);
	const value = (flag) => {
		const index = options.indexOf(flag);
		return index === -1 ? undefined : options[index + 1];
	};
	const label = value('--label');
	if (!label) throw new Error('--label is required');
	if (command.length === 0) throw new Error('a command is required after --');
	return {label, cwd: value('--cwd') ?? `${homedir()}/projects`, focus: !options.includes('--no-focus'), command};
}

export function insertIndexRightOf(tabs, workspaceId, callerTabId) {
	const workspaceTabs = tabs.filter((t) => t.workspace_id === workspaceId);
	const callerIndex = workspaceTabs.findIndex((t) => t.tab_id === callerTabId);
	if (callerIndex === -1) throw new Error(`caller tab ${callerTabId} not found in workspace ${workspaceId}`);
	return callerIndex + 1;
}

const herdr = (...args) => JSON.parse(execFileSync('herdr', args, {encoding: 'utf8'})).result;

function socketRequest(method, params) {
	const socketPath = process.env.HERDR_SOCKET_PATH ?? `${homedir()}/.config/herdr/herdr.sock`;
	return new Promise((resolve, reject) => {
		const socket = createConnection(socketPath);
		let buffer = '';
		socket.setTimeout(5000, () => socket.destroy(new Error(`${method} timed out`)));
		socket.on('error', reject);
		socket.on('data', (chunk) => {
			buffer += chunk;
			const newline = buffer.indexOf('\n');
			if (newline === -1) return;
			socket.end();
			const response = JSON.parse(buffer.slice(0, newline));
			if (response.error) reject(new Error(`${method}: ${JSON.stringify(response.error)}`));
			else resolve(response.result);
		});
		socket.write(`${JSON.stringify({id: 'launch-herdr-tab', method, params})}\n`);
	});
}

async function main() {
	const {label, cwd, focus, command} = parseArgs(process.argv.slice(2));
	const caller = herdr('pane', 'current').pane;
	const created = herdr(
		'tab',
		'create',
		'--workspace',
		caller.workspace_id,
		'--cwd',
		cwd,
		'--label',
		label,
		focus ? '--focus' : '--no-focus',
	);
	const {tab_id: tabId, number} = created.tab;
	const paneId = created.root_pane.pane_id;

	const insertIndex = insertIndexRightOf(herdr('tab', 'list').tabs, caller.workspace_id, caller.tab_id);
	await socketRequest('tab.move', {tab_id: tabId, insert_index: insertIndex});

	execFileSync('herdr', ['pane', 'run', paneId, ...command], {stdio: 'ignore'});
	process.stdout.write(
		`${JSON.stringify({label, number, tabId, paneId, workspaceId: caller.workspace_id, rightOfTabId: caller.tab_id}, null, '\t')}\n`,
	);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		process.stderr.write(`${error.message}\n`);
		process.exit(1);
	});
}
