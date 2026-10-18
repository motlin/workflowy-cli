import {Args, Command, Flags} from "@oclif/core";
import fs from "node:fs";
import path from "node:path";
import {WorkflowyApiClient, WorkflowyInternalClient} from "@workflowy/shared/api";
import type {InternalSession} from "@workflowy/shared/api";
import {WorkflowyInternalAdapter, editOp, moveOp} from "@workflowy/shared/internal";
import {readInternalAuth} from "@workflowy/shared/node";
import {isDeepStrictEqual} from "node:util";
import {WorkflowyWriteThroughClient} from "@workflowy/shared/cache";
import {createDatabase} from "../../db/index.js";
import {CacheService} from "../../services/cache.js";

const DEFAULT_OUT = ".llm/upstream-sync/internal-api-probes.md";
const STEPS = [
	"bootstrap",
	"poll",
	"error-shape",
	"index",
	"restore",
	"root-meta",
	"root-meta-set",
	"root-meta-unset",
] as const;
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
/** How far the `index` step backdates the create's client clock, so the node's `createdAt` shows whether `ct` was kept. */
const CT_SHIFT_SEC = 86_400;
const NEEDS_API_KEY = new Set<string>(["error-shape", "index", "restore"]);

/** `order` after moving `ids` (in that order) to insertion slot `index` among the same parent's children. */
export function expectedMove(order: readonly string[], ids: readonly string[], index: number): string[] {
	const kept = (part: readonly string[]) => part.filter((id) => !ids.includes(id));
	return [...kept(order.slice(0, index)), ...ids, ...kept(order.slice(index))];
}

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
		"<%= config.bin %> internal probe index --yes-live",
		"<%= config.bin %> internal probe index --yes-live --keep",
		"<%= config.bin %> internal probe restore --yes-live",
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
		keep: Flags.boolean({
			description:
				"Leave the `index` or `restore` fixture in the sandbox for a visual check (delete it afterwards)",
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
		const apiKey = NEEDS_API_KEY.has(args.step) ? process.env.WORKFLOWY_API_KEY : undefined;
		if (NEEDS_API_KEY.has(args.step) && !apiKey) {
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
		const lines = await this.runStep(args.step, client, recorded, flags.crosscheck, apiKey, flags.keep);
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
		keep: boolean,
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
		if (step === "index") {
			return this.index(
				client,
				new WorkflowyApiClient(apiKey ?? "", undefined, process.env.WORKFLOWY_API_URL),
				keep,
			);
		}
		if (step === "restore") {
			return this.restore(
				client,
				new WorkflowyApiClient(apiKey ?? "", undefined, process.env.WORKFLOWY_API_URL),
				keep,
			);
		}
		if (step === "root-meta") {
			return this.rootMeta(client);
		}
		return step === "root-meta-set" ? this.rootMetaSet(client) : this.rootMetaUnset(client);
	}

	/**
	 * Exact-index tree writes through the adapter on a fresh sandbox fixture with
	 * children `a,b,c`: `createAt` index 1 (client uuid, backdated `ct`), `moveTo`
	 * to the top, a same-parent down move, and a two-id `bulk_move`. After each
	 * step the order is read from the public API and from the cache the adapter
	 * wrote through. The fixture is deleted unless `keep`.
	 */
	private async index(client: WorkflowyInternalClient, api: WorkflowyApiClient, keep: boolean): Promise<string[]> {
		const {id: parentId} = await api.createNode({
			parent_id: SANDBOX_ID,
			name: `probe index ${new Date().toISOString()}`,
			position: "bottom",
		});
		assertUnderSandbox(await readAncestors(api, (await api.getNode(parentId)).parent_id));
		const labels = new Map<string, string>();
		for (const name of ["a", "b", "c"]) {
			const {id} = await api.createNode({parent_id: parentId, name, position: "bottom"});
			labels.set(id, name);
		}
		const db = createDatabase();
		const cache = new CacheService(db);
		const writeThrough = new WorkflowyWriteThroughClient(api, cache);
		const lines = ["- Fixture: fresh child of the sandbox with children `a,b,c` (public API); ancestors verified"];
		try {
			await writeThrough.refreshChildren([parentId]);
			const byLabel = (label: string) => [...labels].find(([, name]) => name === label)?.[0] ?? label;
			const named = (ids: string[]) => ids.map((id) => labels.get(id) ?? id).join(",");
			let order = (await writeThrough.liveChildren(parentId)).map((node) => node.id);
			const check = async (step: string, expected: string[]) => {
				const live = (await writeThrough.liveChildren(parentId)).map((node) => node.id);
				const cached = cache.getChildren(parentId).map((node) => node.id);
				const ok = isDeepStrictEqual(live, expected) && isDeepStrictEqual(cached, expected);
				lines.push(
					`- ${step}: expected \`${named(expected)}\`; public API \`${named(live)}\`; cache \`${named(cached)}\` (${ok ? "MATCH" : "MISMATCH"})`,
				);
				order = live;
			};

			const startSec = Math.floor(Date.now() / 1000);
			const backdated = new WorkflowyInternalAdapter({
				client,
				db,
				writeThrough,
				now: () => Date.now() - CT_SHIFT_SEC * 1000,
			});
			const {id: newId} = await backdated.createAt({parentId, index: 1, name: "new"});
			labels.set(newId, "new");
			await check("`createAt(index 1)` (`bulk_create`)", expectedMove([...order, newId], [newId], 1));
			const created = await api.getNode(newId).catch(() => {});
			const createdAt = created?.createdAt;
			lines.push(
				`- Client-chosen uuid: ${created?.parent_id === parentId ? "accepted (public API returns the node under that id)" : "NOT found under the id the client chose"}`,
				`- \`ct\` (backdated ${CT_SHIFT_SEC / 3600}h): ${
					createdAt === undefined
						? "unknown (no createdAt)"
						: Math.abs(createdAt - (startSec - CT_SHIFT_SEC)) < 600
							? "accepted (createdAt matches the backdated clock)"
							: Math.abs(createdAt - startSec) < 600
								? "ignored (createdAt is server time)"
								: `inconclusive (createdAt ${createdAt - startSec}s from now)`
				}`,
			);

			const adapter = new WorkflowyInternalAdapter({client, db, writeThrough});
			const c = byLabel("c");
			await adapter.moveTo({ids: [c], parentId, index: 0});
			await check("`moveTo(c, index 0)` (`move`)", expectedMove(order, [c], 0));
			const a = byLabel("a");
			await adapter.moveTo({ids: [a], parentId, index: 3});
			await check("same-parent `moveTo(a, index 3)` (`move`, down)", expectedMove(order, [a], 3));
			const pair = [byLabel("b"), newId];
			await adapter.moveTo({ids: pair, parentId, index: 0});
			await check("`moveTo([b,new], index 0)` (`bulk_move`)", expectedMove(order, pair, 0));
		} finally {
			if (keep) {
				lines.push(`- Fixture kept for a visual check: \`${parentId}\` (delete it afterwards)`);
			} else {
				assertUnderSandbox(await readAncestors(api, (await api.getNode(parentId)).parent_id));
				await writeThrough.deleteNode(parentId);
				lines.push("- Cleanup: fixture deleted through the write-through client");
			}
		}
		return lines;
	}

	/**
	 * Delete and restore with the original id on a fresh sandbox fixture: parents
	 * `from` and `to` (`to` holds `existing`), and under `from` a completed `target`
	 * with a note and a grandchild. `target` is deleted (public API), restored by
	 * `undelete` into `to` at index 0, deleted again, and restored by
	 * `POST /trash/restore/<id>/`. After each restore the id, parent, slot,
	 * children, note, completion and created time are compared with the original
	 * through the public API and the write-through cache. The fixture is deleted
	 * unless `keep`.
	 */
	private async restore(client: WorkflowyInternalClient, api: WorkflowyApiClient, keep: boolean): Promise<string[]> {
		const stamp = new Date().toISOString();
		const {id: rootId} = await api.createNode({
			parent_id: SANDBOX_ID,
			name: `probe restore ${stamp}`,
			position: "bottom",
		});
		assertUnderSandbox(await readAncestors(api, (await api.getNode(rootId)).parent_id));
		const db = createDatabase();
		const cache = new CacheService(db);
		const writeThrough = new WorkflowyWriteThroughClient(api, cache);
		const lines = [
			"- Fixture: fresh sandbox child with parents `from` and `to` (`to` holds `existing`); under `from` a completed `target` with a note and a grandchild (public API); ancestors verified",
		];
		try {
			const {id: fromId} = await writeThrough.createNode({parent_id: rootId, name: "from", position: "bottom"});
			const {id: toId} = await writeThrough.createNode({parent_id: rootId, name: "to", position: "bottom"});
			const {id: existingId} = await writeThrough.createNode({
				parent_id: toId,
				name: "existing",
				position: "bottom",
			});
			const {id: targetId} = await writeThrough.createNode({
				parent_id: fromId,
				name: "target",
				note: "target note",
				position: "bottom",
			});
			const {id: grandchildId} = await writeThrough.createNode({
				parent_id: targetId,
				name: "grandchild",
				position: "bottom",
			});
			await writeThrough.completeNode(targetId);
			const labels = new Map([
				[rootId, "fixture"],
				[fromId, "from"],
				[toId, "to"],
				[existingId, "existing"],
				[targetId, "target"],
				[grandchildId, "grandchild"],
			]);
			const named = (ids: string[]) => ids.map((id) => labels.get(id) ?? id).join(",");
			const original = await api.getNode(targetId);
			const snapshot = (node: typeof original) => ({
				name: node.name,
				note: node.note ?? null,
				completed: node.completed,
				createdAt: node.createdAt,
			});
			const deleteTarget = async () => {
				assertUnderSandbox(await readAncestors(api, (await api.getNode(targetId)).parent_id));
				await writeThrough.deleteNode(targetId);
			};
			const report = async (label: string, expectedParent: string, expectedSiblings: string[]) => {
				const restored = await api.getNode(targetId).catch(() => {});
				if (restored === undefined) {
					lines.push(`- ${label}: public API has no node under the original id (id NOT kept)`);
					return;
				}
				const parentId = restored.parent_id ?? null;
				assertUnderSandbox(await readAncestors(api, parentId));
				const siblings = (await writeThrough.liveChildren(parentId)).map((node) => node.id);
				const children = (await writeThrough.liveChildren(targetId)).map((node) => node.id);
				const before = snapshot(original);
				const after = snapshot(restored);
				const kept = Object.entries(before).map(([key, was]) => {
					const now: unknown = Reflect.get(after, key);
					return `${key} ${isDeepStrictEqual(was, now) ? "kept" : `CHANGED (\`${JSON.stringify(was)}\` -> \`${JSON.stringify(now)}\`)`}`;
				});
				const cached = cache.getNode(targetId);
				const cachedSiblings = cache.getChildren(parentId).map((node) => node.id);
				const cachedChildren = cache.getChildren(targetId).map((node) => node.id);
				lines.push(
					`- ${label}: id kept; parent \`${labels.get(parentId ?? "") ?? String(parentId)}\` (expected \`${labels.get(expectedParent)}\`); siblings \`${named(siblings)}\` (expected \`${named(expectedSiblings)}\`, ${isDeepStrictEqual(siblings, expectedSiblings) ? "MATCH" : "MISMATCH"})`,
					`  - Public API: children \`${named(children)}\` (${isDeepStrictEqual(children, [grandchildId]) ? "kept" : "LOST"}); ${kept.join("; ")}`,
					`  - Cache: node ${cached === undefined ? "ABSENT" : `present under \`${labels.get(cached.parentId ?? "") ?? String(cached.parentId)}\``}; siblings \`${named(cachedSiblings)}\`; children \`${named(cachedChildren)}\``,
				);
			};

			await deleteTarget();
			const adapter = new WorkflowyInternalAdapter({client, db, writeThrough});
			await adapter.restore({id: targetId, parentId: toId, index: 0});
			await report("`restore(target, to, index 0)` (`undelete`)", toId, [targetId, existingId]);

			await deleteTarget();
			await adapter.restore({id: targetId});
			await report("`restore(target)` (`POST /trash/restore/<id>/`)", toId, [targetId, existingId]);
		} finally {
			if (keep) {
				lines.push(`- Fixture kept for a visual check: \`${rootId}\` (delete it afterwards)`);
			} else {
				assertUnderSandbox(await readAncestors(api, (await api.getNode(rootId)).parent_id));
				await writeThrough.deleteNode(rootId);
				lines.push("- Cleanup: fixture deleted through the write-through client");
			}
		}
		return lines;
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
