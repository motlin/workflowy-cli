import {Args, Command, Flags} from "@oclif/core";
import fs from "node:fs";
import path from "node:path";
import {WorkflowyInternalClient} from "@workflowy/shared/api";
import {readInternalAuth} from "@workflowy/shared/node";

const DEFAULT_OUT = ".llm/upstream-sync/internal-api-probes.md";
const STEPS = ["bootstrap", "poll"] as const;
const BODY_PREVIEW_CHARS = 200;

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

export default class Probe extends Command {
	static override description =
		"Run one read-only live probe of Workflowy's internal API and append the findings to a markdown log";

	static override examples = [
		"<%= config.bin %> internal probe bootstrap --yes-live",
		"<%= config.bin %> internal probe poll --yes-live",
		"<%= config.bin %> internal probe poll --no-crosscheck --yes-live",
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
		out: Flags.string({description: "Markdown file the findings are appended to", default: DEFAULT_OUT}),
	};

	public async run(): Promise<void> {
		const {args, flags} = await this.parse(Probe);
		if (!flags["yes-live"]) {
			this.error("Live probe against workflowy.com: pass --yes-live to run it");
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
		const lines =
			args.step === "bootstrap"
				? await this.bootstrap(client, recorded)
				: await this.poll(client, recorded, flags.crosscheck);
		const title = args.step === "poll" && !flags.crosscheck ? "poll --no-crosscheck" : args.step;
		const section = ["", `## ${title} (${startedAt})`, "", ...lines, ""].join("\n");
		fs.mkdirSync(path.dirname(flags.out), {recursive: true});
		fs.appendFileSync(flags.out, section);
		this.log(section);
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

	/** One pure poll (no ops) with the bootstrap tx id, built like `PushAndPoll` but sent once and recorded raw. */
	private async poll(
		client: WorkflowyInternalClient,
		recorded: RecordedRequest[],
		crosscheck: boolean,
	): Promise<string[]> {
		const session = await client.bootstrap();
		const pushPollId = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
		const form = new URLSearchParams();
		form.append("client_id", session.clientId);
		form.append("client_version", session.clientVersion);
		form.append("push_poll_id", pushPollId);
		form.append("push_poll_data", JSON.stringify([{most_recent_operation_transaction_id: session.txId}]));
		form.append("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone);
		await client.postForm(`/push_and_poll?uti=${session.userId}-${Date.now()}-${pushPollId}`, form);
		const poll = recorded.findLast((request) => request.path === "/push_and_poll");
		if (poll === undefined) {
			throw new Error("No /push_and_poll response was recorded");
		}
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
}
