import {Args, Command, Flags} from "@oclif/core";
import fs from "node:fs";
import path from "node:path";
import {WorkflowyApiClient, WorkflowyInternalClient} from "@workflowy/shared/api";
import type {InternalSession} from "@workflowy/shared/api";
import {WorkflowyInternalAdapter, editOp, moveOp} from "@workflowy/shared/internal";
import {readInternalAuth} from "@workflowy/shared/node";
import {isDeepStrictEqual} from "node:util";
import {createDatabase} from "../../db/index.js";

const DEFAULT_OUT = ".llm/upstream-sync/internal-api-probes.md";
const STEPS = ["bootstrap", "poll", "error-shape", "root-meta", "root-meta-set", "root-meta-unset"] as const;
const ROOT_META_WRITES = new Set<string>(["root-meta-set", "root-meta-unset"]);
/** Account-global root metadata paths whose shapes `root-meta` records (read only). */
const ROOT_META_PATHS = [
	["starring", "locations"],
	["starring", "order"],
	["color", "tags"],
	["dateFormat"],
	["timeFormat"],
	["weekStartDay"],
	["slash", "discovered"],
	["notesRootId"],
];
/** The throwaway root metadata key the write steps set and remove; nothing else is ever written. */
const PROBE_KEY = "probe";
const PROBE_VALUE = {x: "1"};
const RENAMED = "probe error-shape: renamed";

/** The only subtree a live probe may write to. */
export const SANDBOX_ID = "7aed376b-80c8-42c5-8065-ab03ee6d2ae0";

/** Throws unless the sandbox is among `ancestorIds`; every probe write is gated on it. */
export function assertUnderSandbox(ancestorIds: readonly string[]): void {
	if (!ancestorIds.includes(SANDBOX_ID)) {
		throw new Error(`Refusing to write outside the sandbox: ${SANDBOX_ID} is not an ancestor`);
	}
}

/** Ancestor ids from `parentId` upward (nearest first, stopping at the sandbox), read from the public API. */
async function readAncestors(api: WorkflowyApiClient, firstParentId: string | null | undefined): Promise<string[]> {
	const ancestors: string[] = [];
	let parentId = firstParentId ?? null;
	while (parentId !== null) {
		ancestors.push(parentId);
		if (parentId === SANDBOX_ID) {
			break;
		}
		parentId = (await api.getNode(parentId)).parent_id ?? null;
	}
	return ancestors;
}
const BODY_PREVIEW_CHARS = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function union(values: unknown[]): string {
	return [...new Set(values.map((value) => typeShape(value, false)))].toSorted().join(" | ");
}

/**
 * A value redacted to its type. The top-level object becomes a `Record` (its keys are
 * user data such as tag names or ids); nested objects keep their structural keys.
 */
export function typeShape(value: unknown, topLevel = true): string {
	if (value === undefined) {
		return "absent";
	}
	if (value === null) {
		return "null";
	}
	if (Array.isArray(value)) {
		return `Array<${value.length === 0 ? "never" : union(value)}>`;
	}
	if (isRecord(value)) {
		const entries = Object.entries(value);
		if (entries.length === 0) {
			return "{}";
		}
		if (topLevel) {
			return `Record<string, ${union(entries.map(([, inner]) => inner))}>`;
		}
		return `{${entries
			.toSorted(([a], [b]) => a.localeCompare(b))
			.map(([key, inner]) => `${key}: ${typeShape(inner, false)}`)
			.join("; ")}}`;
	}
	return typeof value;
}

function getPath(value: unknown, keys: string[]): unknown {
	return keys.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value);
}

interface RecordedRequest {
	method: string;
	path: string;
	status: number;
	bytes: number;
	text: string;
	clientIdHeader: string | null;
}

function urlOf(input: string | URL | Request): string {
	return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/** A string or number as text; anything else (absent, object) as undefined. */
function scalarText(value: unknown): string | undefined {
	return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

/**
 * A fetch that records each response (path without query, status, size, the
 * `wfclientid` header) and, when `stripCrosscheck` is set, removes
 * `crosscheck_user_id` from form bodies before they leave.
 */
function recordingFetch(recorded: RecordedRequest[], stripCrosscheck: boolean): typeof fetch {
	return async (input, init) => {
		let requestInit = init;
		if (stripCrosscheck && typeof init?.body === "string") {
			const form = new URLSearchParams(init.body);
			form.delete("crosscheck_user_id");
			requestInit = {...init, body: form.toString()};
		}
		const response = await globalThis.fetch(input, requestInit);
		const text = await response.clone().text();
		recorded.push({
			method: requestInit?.method ?? "GET",
			path: new URL(urlOf(input)).pathname,
			status: response.status,
			bytes: Buffer.byteLength(text),
			text,
			clientIdHeader: response.headers.get("wfclientid"),
		});
		return response;
	};
}

/** The character classes of a value (digits to 9, letters to a/A), so formats are recorded without values. */
export function shapeOf(value: string): string {
	return value.replaceAll(/\d/gu, "9").replaceAll(/[a-z]/gu, "a").replaceAll(/[A-Z]/gu, "A");
}

function objectKeys(value: unknown): string[] {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.keys(value).toSorted() : [];
}

function codeList(keys: string[]): string {
	return keys.length === 0 ? "(none)" : keys.map((key) => `\`${key}\``).join(", ");
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

function findInitTxId(text: string): string | undefined {
	const treeData: unknown = Reflect.get(Object(parseJson(text)), "projectTreeData");
	const info: unknown = Reflect.get(Object(treeData), "mainProjectTreeInfo");
	return scalarText(Reflect.get(Object(info), "initialMostRecentOperationTransactionId"));
}

/** One `/push_and_poll` built like `PushAndPoll` but sent once, with no retries, returning the recorded raw response. */
async function sendRawPush(
	client: WorkflowyInternalClient,
	session: InternalSession,
	recorded: RecordedRequest[],
	tree: Record<string, unknown>,
): Promise<RecordedRequest> {
	const pushPollId = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
	const form = new URLSearchParams();
	form.append("client_id", session.clientId);
	form.append("client_version", session.clientVersion);
	form.append("push_poll_id", pushPollId);
	form.append("push_poll_data", JSON.stringify([tree]));
	form.append("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone);
	await client.postForm(`/push_and_poll?uti=${session.userId}-${Date.now()}-${pushPollId}`, form);
	const push = recorded.findLast((request) => request.path === "/push_and_poll");
	if (push === undefined) {
		throw new Error("No /push_and_poll response was recorded");
	}
	return push;
}

export default class Probe extends Command {
	static override description =
		"Run one live probe of Workflowy's internal API (read-only, or writes confined to the sandbox) and append the findings to a markdown log";

	static override examples = [
		"<%= config.bin %> internal probe bootstrap --yes-live",
		"<%= config.bin %> internal probe poll --yes-live",
		"<%= config.bin %> internal probe poll --no-crosscheck --yes-live",
		"<%= config.bin %> internal probe error-shape --yes-live",
		"<%= config.bin %> internal probe root-meta --yes-live",
		"<%= config.bin %> internal probe root-meta-set --yes-live --yes-account-global",
		"<%= config.bin %> internal probe root-meta-unset --yes-live --yes-account-global",
	];

	static override args = {
		step: Args.string({description: "Probe step", options: [...STEPS], required: true}),
	};

	static override flags = {
		"yes-live": Flags.boolean({description: "Confirm the probe may call workflowy.com", default: false}),
		crosscheck: Flags.boolean({
			description: "Send crosscheck_user_id on /push_and_poll (poll only)",
			default: true,
			allowNo: true,
		}),
		"yes-account-global": Flags.boolean({
			description: "Confirm the user approved writing the throwaway account-global root metadata key `probe`",
			default: false,
		}),
		out: Flags.string({description: "Markdown file the findings are appended to", default: DEFAULT_OUT}),
	};

	public async run(): Promise<void> {
		const {args, flags} = await this.parse(Probe);
		if (!flags["yes-live"]) {
			this.error("Live probe against workflowy.com: pass --yes-live to run it");
		}
		if (ROOT_META_WRITES.has(args.step) && !flags["yes-account-global"]) {
			this.error(
				"Root metadata is account-global and cannot be sandboxed: pass --yes-account-global (with the user's approval) to write it",
			);
		}
		const apiKey = args.step === "error-shape" ? process.env.WORKFLOWY_API_KEY : undefined;
		if (args.step === "error-shape" && !apiKey) {
			this.error("WORKFLOWY_API_KEY environment variable is required");
		}
		const auth = readInternalAuth();
		if (!auth) {
			this.error(
				"Set WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD, or run './bin/run.js internal login' via op run",
			);
		}
		const recorded: RecordedRequest[] = [];
		const client = new WorkflowyInternalClient({
			...auth,
			fetch: recordingFetch(recorded, !flags.crosscheck),
		});
		const startedAt = new Date().toISOString();
		const lines = await this.runStep(args.step, client, recorded, flags.crosscheck, apiKey);
		const title = args.step === "poll" && !flags.crosscheck ? "poll --no-crosscheck" : args.step;
		const section = ["", `## ${title} (${startedAt})`, "", ...lines, ""].join("\n");
		fs.mkdirSync(path.dirname(flags.out), {recursive: true});
		fs.appendFileSync(flags.out, section);
		this.log(section);
	}

	private async runStep(
		step: string,
		client: WorkflowyInternalClient,
		recorded: RecordedRequest[],
		crosscheck: boolean,
		apiKey: string | undefined,
	): Promise<string[]> {
		if (step === "bootstrap") {
			return this.bootstrap(client, recorded);
		}
		if (step === "poll") {
			return this.poll(client, recorded, crosscheck);
		}
		if (step === "error-shape") {
			return this.errorShape(
				client,
				recorded,
				new WorkflowyApiClient(apiKey ?? "", undefined, process.env.WORKFLOWY_API_URL),
			);
		}
		if (step === "root-meta") {
			return this.rootMeta(client);
		}
		return step === "root-meta-set" ? this.rootMetaSet(client) : this.rootMetaUnset(client);
	}

	/** Read-only: the shapes of the account-global root metadata keys, values redacted to types. */
	private async rootMeta(client: WorkflowyInternalClient): Promise<string[]> {
		const {rootMetadata} = await client.bootstrap();
		return [
			`- Top-level root metadata keys: ${codeList(objectKeys(rootMetadata))}`,
			...ROOT_META_PATHS.map((keys) => `- \`${keys.join(".")}\`: \`${typeShape(getPath(rootMetadata, keys))}\``),
		];
	}

	/** An adapter over an in-memory cache, so the probe exercises `setRootMeta` without touching the real cache. */
	private adapter(client: WorkflowyInternalClient): WorkflowyInternalAdapter {
		return new WorkflowyInternalAdapter({client, db: createDatabase(":memory:")});
	}

	/** ACCOUNT-GLOBAL write: set the throwaway `probe.x`, then confirm it from a fresh bootstrap. */
	private async rootMetaSet(client: WorkflowyInternalClient): Promise<string[]> {
		const before = (await client.bootstrap()).rootMetadata[PROBE_KEY];
		if (before !== undefined) {
			this.error(`Refusing to write: root metadata already has a \`${PROBE_KEY}\` key`);
		}
		await this.adapter(client).setRootMeta([PROBE_KEY, "x"], PROBE_VALUE.x);
		const after = getPath((await client.bootstrap()).rootMetadata, [PROBE_KEY, "x"]);
		return [
			`- \`${PROBE_KEY}\` before: absent`,
			`- Pushed: \`setRootMeta(["${PROBE_KEY}", "x"], "${PROBE_VALUE.x}")\``,
			`- \`${PROBE_KEY}.x\` after a fresh bootstrap: ${
				after === undefined ? "absent" : `\`${JSON.stringify(after)}\``
			} (round trip ${after === PROBE_VALUE.x ? "CONFIRMED" : "FAILED"})`,
			"- Next: reload workflowy.com once and confirm it still loads, then run `internal probe root-meta-unset --yes-live --yes-account-global`",
		];
	}

	/** ACCOUNT-GLOBAL write: remove `probe` (only when it is exactly the throwaway value), then confirm it is gone. */
	private async rootMetaUnset(client: WorkflowyInternalClient): Promise<string[]> {
		const before = (await client.bootstrap()).rootMetadata[PROBE_KEY];
		if (!isDeepStrictEqual(before, PROBE_VALUE)) {
			this.error(
				`Refusing to remove: root metadata \`${PROBE_KEY}\` is not exactly ${JSON.stringify(PROBE_VALUE)}`,
			);
		}
		await this.adapter(client).setRootMeta([PROBE_KEY], undefined);
		const after = (await client.bootstrap()).rootMetadata[PROBE_KEY];
		return [
			`- \`${PROBE_KEY}\` before: \`${JSON.stringify(before)}\``,
			`- Pushed: \`setRootMeta(["${PROBE_KEY}"], undefined)\``,
			`- \`${PROBE_KEY}\` after a fresh bootstrap: ${
				after === undefined ? "absent (removal CONFIRMED)" : `\`${JSON.stringify(after)}\` (removal FAILED)`
			}`,
		];
	}

	private async bootstrap(client: WorkflowyInternalClient, recorded: RecordedRequest[]): Promise<string[]> {
		const session = await client.bootstrap();
		const init = recorded.find((request) => request.path === "/get_initialization_data");
		const clientId = init?.clientIdHeader ?? null;
		const initTxId = init === undefined ? undefined : findInitTxId(init.text);
		const usedTreeData = recorded.some((request) => request.path === "/get_tree_data/");
		const usedUserData = recorded.some((request) => request.path === "/get_user_data/");
		const versionFromGlobals = recorded.some((request) => {
			const globals: unknown = Reflect.get(Object(parseJson(request.text)), "globals");
			return (
				Array.isArray(globals) && globals.some((pair) => Array.isArray(pair) && pair[0] === "CLIENT_VERSION")
			);
		});
		return [
			`- \`wfclientid\` header: ${clientId === null ? "absent" : `present, shape \`${shapeOf(clientId)}\``}`,
			`- \`client_version\` used: \`${session.clientVersion}\` (${
				versionFromGlobals
					? "from a JSON `globals` CLIENT_VERSION"
					: "client default; no JSON `globals` CLIENT_VERSION"
			})`,
			`- \`initialMostRecentOperationTransactionId\` with \`no_root_children=1\`: ${
				initTxId === undefined ? "absent" : `present, shape \`${shapeOf(initTxId)}\``
			}`,
			`- \`get_tree_data\` fallback needed: ${usedTreeData ? "yes" : "no"}`,
			`- \`get_user_data\` needed for user/settings/root metadata: ${usedUserData ? "yes" : "no"}`,
			`- Requests: ${recorded
				.map((request) =>
					request.path === "/ajax_login"
						? `\`${request.method} ${request.path}\` ${request.status}`
						: `\`${request.method} ${request.path}\` ${request.status} (${request.bytes} bytes)`,
				)
				.join("; ")}`,
		];
	}

	/** One pure poll (no ops) with the bootstrap tx id. */
	private async poll(
		client: WorkflowyInternalClient,
		recorded: RecordedRequest[],
		crosscheck: boolean,
	): Promise<string[]> {
		const session = await client.bootstrap();
		const poll = await sendRawPush(client, session, recorded, {
			most_recent_operation_transaction_id: session.txId,
		});
		const lines = [
			`- \`crosscheck_user_id\` sent: ${crosscheck ? "yes" : "no"}`,
			`- HTTP status: ${poll.status} (${poll.bytes} bytes)`,
			poll.status === 403
				? "- CSRF: enforced or request refused (403)"
				: poll.status >= 200 && poll.status < 300
					? "- CSRF: not enforced (cookie-only client accepted)"
					: `- CSRF: inconclusive (status ${poll.status})`,
		];
		const body = parseJson(poll.text);
		if (body === undefined) {
			const preview = poll.text.slice(0, BODY_PREVIEW_CHARS).replaceAll(/\s+/gu, " ").trim();
			return [...lines, `- Body (not JSON): \`${preview}\``];
		}
		lines.push(`- Response keys: ${codeList(objectKeys(body))}`);
		const results: unknown = Reflect.get(Object(body), "results");
		const first: unknown = Array.isArray(results) ? results[0] : undefined;
		if (first === undefined) {
			return lines;
		}
		const newTxId = scalarText(Reflect.get(Object(first), "new_most_recent_operation_transaction_id"));
		const remote: unknown = Reflect.get(Object(first), "concurrent_remote_operation_transactions");
		const error: unknown = Reflect.get(Object(first), "error");
		lines.push(`- \`results[0]\` keys: ${codeList(objectKeys(first))}`);
		if (typeof error === "string") {
			lines.push(`- \`results[0].error\`: \`${error}\``);
		}
		lines.push(
			`- Tx id advanced: ${
				newTxId === undefined
					? "unknown (no new id)"
					: newTxId === session.txId
						? "no (still current)"
						: "yes (remote changes since bootstrap)"
			}`,
			`- Remote transactions: ${Array.isArray(remote) ? remote.length : "absent"}`,
		);
		return lines;
	}

	/**
	 * One batch of two ops on a fresh sandbox child: a valid `edit` rename, then a
	 * `move` into a parent that does not exist. Records the result's `error` and
	 * whether the first op applied, then deletes the child.
	 */
	private async errorShape(
		client: WorkflowyInternalClient,
		recorded: RecordedRequest[],
		api: WorkflowyApiClient,
	): Promise<string[]> {
		const originalName = `probe error-shape ${new Date().toISOString()}`;
		const {id} = await api.createNode({parent_id: SANDBOX_ID, name: originalName, position: "bottom"});
		assertUnderSandbox(await readAncestors(api, (await api.getNode(id)).parent_id));
		const index = (await api.getChildNodes(SANDBOX_ID)).findIndex((child) => child.id === id);
		const session = await client.bootstrap();
		const clock = {now: Date.now(), dateJoinedSec: session.dateJoinedSec};
		const operations = [
			editOp({...clock, id, name: RENAMED, previous: {name: originalName}}),
			moveOp({
				...clock,
				id,
				parentId: crypto.randomUUID(),
				index: 0,
				from: {parentId: SANDBOX_ID, index: Math.max(index, 0)},
			}),
		];
		const push = await sendRawPush(client, session, recorded, {
			most_recent_operation_transaction_id: session.txId,
			operations,
		});
		const lines = [
			"- Fixture: fresh child created under the sandbox via the public API; ancestors verified",
			"- Batch: `edit` (rename the child) then `move` (into a nonexistent parent), one `/push_and_poll`",
			`- HTTP status: ${push.status}`,
		];
		const body = parseJson(push.text);
		const results: unknown = Reflect.get(Object(body), "results");
		const first: unknown = Array.isArray(results) ? results[0] : undefined;
		if (first === undefined) {
			const preview = push.text.slice(0, BODY_PREVIEW_CHARS).replaceAll(/\s+/gu, " ").trim();
			lines.push(`- Body (no \`results[0]\`): \`${preview}\``);
		} else {
			const error: unknown = Reflect.get(Object(first), "error");
			const serverRun: unknown = Reflect.get(Object(first), "server_run_operation_transaction_json");
			const newTxId = scalarText(Reflect.get(Object(first), "new_most_recent_operation_transaction_id"));
			const serverRunOps: unknown = Reflect.get(Object(parseJson(String(serverRun))), "ops");
			lines.push(
				`- \`results[0]\` keys: ${codeList(objectKeys(first))}`,
				`- \`results[0].error\`: ${typeof error === "string" ? `\`${error}\`` : "absent"}`,
				`- \`server_run_operation_transaction_json\`: ${
					typeof serverRun === "string"
						? `present (${
								Array.isArray(serverRunOps)
									? serverRunOps
											.map((op) => `\`${String(Reflect.get(Object(op), "type"))}\``)
											.join(", ")
									: "unparsed"
							})`
						: "absent"
				}`,
				`- Tx id advanced: ${newTxId === undefined ? "unknown" : newTxId === session.txId ? "no" : "yes"}`,
			);
		}
		const after = await api.getNode(id);
		const parentAfter = after.parent_id ?? null;
		const ancestorsAfter = await readAncestors(api, parentAfter);
		lines.push(
			`- First op (\`edit\`) applied: ${after.name === RENAMED ? "yes (name changed)" : "no (name unchanged)"}`,
			`- Child parent after push: ${parentAfter === SANDBOX_ID ? "sandbox" : `not the sandbox (\`${String(parentAfter)}\`)`}`,
		);
		assertUnderSandbox(ancestorsAfter);
		await api.deleteNode(id);
		lines.push("- Cleanup: child deleted via the public API");
		return lines;
	}
}
