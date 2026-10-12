#!/usr/bin/env node
// Open a labelled herdr tab immediately right of the caller's tab and run a command in it.
// Usage: launch-herdr-tab.mts --label <label> [--cwd <dir>] [--no-focus] -- <command...>
// `herdr tab create` always appends the tab last and the CLI has no move command, so the
// reposition goes through the socket API's `tab.move` request.
import {execFileSync} from "node:child_process";
import {createConnection} from "node:net";
import {homedir} from "node:os";
import {errorMessage, expectObject, isObject, parseJson, stringField} from "./json.mts";
import type {JsonObject} from "./json.mts";

export interface LaunchOptions {
	label: string;
	cwd: string;
	focus: boolean;
	command: string[];
}

export interface HerdrTab {
	workspace_id: string;
	tab_id: string;
}

export function parseArgs(argv: string[]): LaunchOptions {
	const separator = argv.indexOf("--");
	const options = separator === -1 ? argv : argv.slice(0, separator);
	const command = separator === -1 ? [] : argv.slice(separator + 1);
	const value = (flag: string): string | undefined => {
		const index = options.indexOf(flag);
		return index === -1 ? undefined : options[index + 1];
	};
	const label = value("--label");
	if (!label) {
		throw new Error("--label is required");
	}
	if (command.length === 0) {
		throw new Error("a command is required after --");
	}
	return {label, cwd: value("--cwd") ?? `${homedir()}/projects`, focus: !options.includes("--no-focus"), command};
}

export function insertIndexRightOf(tabs: readonly HerdrTab[], workspaceId: string, callerTabId: string): number {
	const workspaceTabs = tabs.filter((t) => t.workspace_id === workspaceId);
	const callerIndex = workspaceTabs.findIndex((t) => t.tab_id === callerTabId);
	if (callerIndex === -1) {
		throw new Error(`caller tab ${callerTabId} not found in workspace ${workspaceId}`);
	}
	return callerIndex + 1;
}

const herdr = (...args: string[]): JsonObject =>
	expectObject(
		expectObject(parseJson(execFileSync("herdr", args, {encoding: "utf8"})), "herdr output").result,
		"herdr result",
	);

/** A required string field of a herdr response object. */
function requireString(object: JsonObject, key: string): string {
	const value = stringField(object, key);
	if (value === undefined) {
		throw new TypeError(`herdr response is missing ${key}`);
	}
	return value;
}

function toHerdrTabs(value: unknown): HerdrTab[] {
	if (!Array.isArray(value)) {
		throw new TypeError("herdr tab list is not an array");
	}
	return value.map((entry) => {
		const tab = expectObject(entry, "herdr tab");
		return {workspace_id: requireString(tab, "workspace_id"), tab_id: requireString(tab, "tab_id")};
	});
}

export async function socketRequest(
	method: string,
	params: JsonObject,
	socketPath = process.env.HERDR_SOCKET_PATH ?? `${homedir()}/.config/herdr/herdr.sock`,
): Promise<unknown> {
	return new Promise<unknown>((resolve, reject) => {
		const socket = createConnection(socketPath);
		socket.setEncoding("utf8");
		let buffer = "";
		socket.setTimeout(5000, () => {
			socket.destroy(new Error(`${method} timed out`));
		});
		socket.on("error", reject);
		socket.on("data", (chunk: Buffer | string) => {
			buffer += chunk.toString();
			const newline = buffer.indexOf("\n");
			if (newline === -1) {
				return;
			}
			socket.end();
			const parsed = parseJson(buffer.slice(0, newline));
			const response = isObject(parsed) ? parsed : {};
			const failed = Boolean(response.error);
			if (failed) {
				reject(new Error(`${method}: ${JSON.stringify(response.error)}`));
			} else {
				resolve(response.result);
			}
		});
		socket.write(`${JSON.stringify({id: "launch-herdr-tab", method, params})}\n`);
	});
}

async function main(): Promise<void> {
	const {label, cwd, focus, command} = parseArgs(process.argv.slice(2));
	const caller = expectObject(herdr("pane", "current").pane, "herdr pane");
	const workspaceId = requireString(caller, "workspace_id");
	const callerTabId = requireString(caller, "tab_id");
	const created = herdr(
		"tab",
		"create",
		"--workspace",
		workspaceId,
		"--cwd",
		cwd,
		"--label",
		label,
		focus ? "--focus" : "--no-focus",
	);
	const createdTab = expectObject(created.tab, "herdr created tab");
	const tabId = requireString(createdTab, "tab_id");
	const {number} = createdTab;
	const paneId = requireString(expectObject(created.root_pane, "herdr root pane"), "pane_id");

	const insertIndex = insertIndexRightOf(toHerdrTabs(herdr("tab", "list").tabs), workspaceId, callerTabId);
	await socketRequest("tab.move", {tab_id: tabId, insert_index: insertIndex});

	execFileSync("herdr", ["pane", "run", paneId, ...command], {stdio: "ignore"});
	process.stdout.write(
		`${JSON.stringify({label, number, tabId, paneId, workspaceId, rightOfTabId: callerTabId}, null, "\t")}\n`,
	);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		await main();
	} catch (error) {
		process.stderr.write(`${errorMessage(error)}\n`);
		process.exit(1);
	}
}
