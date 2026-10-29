import {applyApiBatch, beginApiImport, finishApiImport, importInternalMetadata} from "@workflowy/shared/cache";
import type {ApiImportState, ImportApiResult} from "@workflowy/shared/cache";
import type {TreeSnapshot} from "@workflowy/shared/api";
import type {AppDatabase} from "@workflowy/shared/db";
import {nodeBatches} from "./export-stream";

const BATCH_SIZE = 2000;
const DEFAULT_INTERVAL_MINUTES = 30;
const RATE_LIMIT_BACKOFF_MS = 60_000;

/** Bindings the sync job reads; all but the bucket are optional. */
export interface SyncEnv {
	SNAPSHOTS: R2Bucket;
	WORKFLOWY_API_KEY?: string;
	WORKFLOWY_API_URL?: string;
	/** Minutes between runs once one has finished (default 30). */
	SYNC_INTERVAL_MINUTES?: string;
	/** CPU budget knob: batches applied per alarm before yielding (default: all). */
	SYNC_BATCHES_PER_TICK?: string;
	/** Delay before the next alarm when a run yields mid-import (default 0). */
	SYNC_TICK_DELAY_MS?: string;
}

export interface SyncDeps {
	storage: DurableObjectStorage;
	db: AppDatabase;
	env: SyncEnv;
	/** Reads the internal tree data when internal auth exists; undefined when it does not. */
	readTreeSnapshot?: () => Promise<TreeSnapshot> | undefined;
	/** Reads the account's Workflowy epoch when internal auth exists; undefined when it does not. */
	readEpoch?: () => Promise<number> | undefined;
	now?: () => number;
}

type Phase = "idle" | "fetching" | "importing";

interface Job {
	phase: Phase;
	exportKey: string;
	/** Nodes of the export already applied; the stream resumes after them. */
	applied: number;
	importTimestamp: string;
	totals: Pick<
		ApiImportState,
		"totalNodes" | "nodesAdded" | "nodesUpdated" | "nodesUnchanged" | "contentUpdated" | "metadataUpdated"
	>;
	startedAt: number;
}

export type SyncResult =
	| ({status: "ok"; exportKey: string; finishedAt: number; durationMs: number} & Omit<
			ImportApiResult,
			"importTimestamp"
	  > & {
				/** Set when get_tree_data failed: the public import still completed, internal metadata did not. */
				treeDataError?: string;
			})
	| {status: "rate_limited" | "error"; message: string; at: number};

export interface SyncStatus {
	phase: Phase;
	applied: number;
	nextAlarmAt: number | null;
	lastResult: SyncResult | null;
}

/** The streaming import, driven by Durable Object alarms with all progress in the object's own SQLite. */
export class SyncJob {
	constructor(private readonly deps: SyncDeps) {
		deps.storage.sql.exec(
			"CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL); " +
				"CREATE TABLE IF NOT EXISTS sync_seen (id TEXT PRIMARY KEY)",
		);
	}

	private get sql(): SqlStorage {
		return this.deps.storage.sql;
	}

	private now(): number {
		return (this.deps.now ?? Date.now)();
	}

	// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the shape it wrote
	private read<T>(key: string): T | null {
		const rows = this.sql.exec("SELECT value FROM sync_state WHERE key = ?", key).toArray();
		const value = rows[0]?.value;
		// oxlint-disable-next-line typescript/no-unsafe-return -- this table only holds what write() serialized
		return typeof value === "string" ? JSON.parse(value) : null;
	}

	private write(key: string, value: unknown): void {
		this.sql.exec("INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)", key, JSON.stringify(value));
	}

	/** Make a run start (or continue) as soon as possible. */
	async syncNow(): Promise<SyncStatus> {
		await this.deps.storage.setAlarm(this.now());
		return this.status();
	}

	async status(): Promise<SyncStatus> {
		const job = this.read<Job>("job");
		return {
			phase: job?.phase ?? "idle",
			applied: job?.applied ?? 0,
			nextAlarmAt: await this.deps.storage.getAlarm(),
			lastResult: this.read<SyncResult>("lastResult"),
		};
	}

	/** One alarm: start a run when idle, otherwise continue the one in progress. */
	async tick(): Promise<void> {
		let job = this.read<Job>("job");
		if (job === null || job.phase === "idle") {
			job = {
				phase: "fetching",
				exportKey: "",
				applied: 0,
				importTimestamp: "",
				totals: {
					totalNodes: 0,
					nodesAdded: 0,
					nodesUpdated: 0,
					nodesUnchanged: 0,
					contentUpdated: 0,
					metadataUpdated: 0,
				},
				startedAt: this.now(),
			};
			this.write("job", job);
		}
		try {
			if (job.phase === "fetching") {
				const fetched = await this.fetchExport(job);
				if (fetched === undefined) {
					return;
				}
				job = fetched;
			}
			await this.importExport(job);
		} catch (error) {
			this.finishRun({
				status: "error",
				message: error instanceof Error ? error.message : String(error),
				at: this.now(),
			});
			await this.scheduleNextRun();
		}
	}

	/** Store config.workflowy_epoch once, when internal auth exists; a failure leaves it for the next run. */
	private async fillEpoch(): Promise<void> {
		const have = this.sql.exec("SELECT 1 FROM config WHERE key = 'workflowy_epoch'").toArray().length > 0;
		if (have) {
			return;
		}
		try {
			const epoch = await this.deps.readEpoch?.();
			if (epoch !== undefined) {
				const stamp = new Date(this.now()).toISOString();
				this.sql.exec(
					"INSERT OR IGNORE INTO config (key, value, created_at, updated_at) VALUES ('workflowy_epoch', ?, ?, ?)",
					String(epoch),
					stamp,
					stamp,
				);
			}
		} catch {
			// The epoch only serves backup imports; the sync itself does not depend on it.
		}
	}

	private finishRun(result: SyncResult): void {
		this.write("lastResult", result);
		this.write("job", null);
		this.sql.exec("DELETE FROM sync_seen");
	}

	private async scheduleNextRun(): Promise<void> {
		const minutes = Number(this.deps.env.SYNC_INTERVAL_MINUTES);
		const interval = (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_INTERVAL_MINUTES) * 60_000;
		await this.deps.storage.setAlarm(this.now() + interval);
	}

	/** GET the export and tee it into R2. Returns undefined when the run was rescheduled instead. */
	private async fetchExport(job: Job): Promise<Job | undefined> {
		const {env} = this.deps;
		if (!env.WORKFLOWY_API_KEY) {
			this.finishRun({status: "error", message: "WORKFLOWY_API_KEY is not configured", at: this.now()});
			await this.scheduleNextRun();
			return undefined;
		}
		const base = (env.WORKFLOWY_API_URL === "" ? undefined : env.WORKFLOWY_API_URL) ?? "https://workflowy.com";
		const response = await fetch(`${base}/api/v1/nodes-export`, {
			headers: {Authorization: `Bearer ${env.WORKFLOWY_API_KEY}`},
		});
		if (response.status === 429) {
			const retryAfter = Number(response.headers.get("retry-after"));
			const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : RATE_LIMIT_BACKOFF_MS;
			await response.body?.cancel();
			// The job stays in "fetching", so the next alarm retries the same run.
			this.write("lastResult", {status: "rate_limited", message: "Workflowy answered 429", at: this.now()});
			await this.deps.storage.setAlarm(this.now() + delay);
			return undefined;
		}
		if (!response.ok || response.body === null) {
			throw new Error(`nodes-export failed with ${response.status}`);
		}
		const exportKey = `exports/${new Date(this.now()).toISOString().replaceAll(":", "-")}.json`;
		const length = Number(response.headers.get("content-length"));
		if (Number.isFinite(length) && length > 0) {
			const fixed = new FixedLengthStream(length);
			const piping = response.body.pipeTo(fixed.writable);
			await Promise.all([env.SNAPSHOTS.put(exportKey, fixed.readable), piping]);
		} else {
			await env.SNAPSHOTS.put(exportKey, await response.arrayBuffer());
		}
		const next: Job = {...job, phase: "importing", exportKey, importTimestamp: new Date(this.now()).toISOString()};
		this.write("job", next);
		return next;
	}

	private importState(job: Job): ApiImportState {
		const state = beginApiImport(this.deps.db, {timestamp: new Date(job.importTimestamp)});
		Object.assign(state, job.totals);
		for (const row of this.sql.exec("SELECT id FROM sync_seen").toArray()) {
			if (typeof row.id === "string") {
				state.seenIds.add(row.id);
			}
		}
		return state;
	}

	private async importExport(job: Job): Promise<void> {
		const {env, storage} = this.deps;
		const object = await env.SNAPSHOTS.get(job.exportKey);
		if (object === null) {
			throw new Error(`export ${job.exportKey} is missing from R2`);
		}
		const state = this.importState(job);
		const perTick = Number(env.SYNC_BATCHES_PER_TICK);
		const limit = Number.isFinite(perTick) && perTick > 0 ? perTick : Infinity;
		let batches = 0;
		let yielded = false;
		// oxlint-disable-next-line typescript/no-unsafe-argument -- the workers types declare R2ObjectBody.body as ReadableStream<any>
		for await (const batch of nodeBatches(object.body, {
			size: BATCH_SIZE,
			skip: job.applied,
		})) {
			if (batches >= limit) {
				yielded = true;
				break;
			}
			// One transaction, so the cursor never runs ahead of or behind the rows it counts.
			storage.transactionSync(() => {
				applyApiBatch(state, batch);
				for (const node of batch) {
					if (state.seenIds.has(node.id)) {
						this.sql.exec("INSERT OR IGNORE INTO sync_seen (id) VALUES (?)", node.id);
					}
				}
				job = {
					...job,
					applied: job.applied + batch.length,
					totals: {
						totalNodes: state.totalNodes,
						nodesAdded: state.nodesAdded,
						nodesUpdated: state.nodesUpdated,
						nodesUnchanged: state.nodesUnchanged,
						contentUpdated: state.contentUpdated,
						metadataUpdated: state.metadataUpdated,
					},
				};
				this.write("job", job);
			});
			batches++;
		}
		if (yielded) {
			const delay = Number(env.SYNC_TICK_DELAY_MS);
			await storage.setAlarm(this.now() + (Number.isFinite(delay) && delay > 0 ? delay : 0));
			return;
		}

		let snapshot: TreeSnapshot | undefined;
		let treeDataError: string | undefined;
		try {
			snapshot = await this.deps.readTreeSnapshot?.();
		} catch (error) {
			// The public export alone is still a complete import; metadata catches up on the next run.
			snapshot = undefined;
			treeDataError = error instanceof Error ? error.message : String(error);
		}
		await this.fillEpoch();
		const result = finishApiImport(state, snapshot?.items);
		if (snapshot !== undefined) {
			importInternalMetadata(this.deps.db, snapshot, this.now());
		}
		const {importTimestamp: _timestamp, ...counts} = result;
		this.finishRun({
			status: "ok",
			exportKey: job.exportKey,
			finishedAt: this.now(),
			durationMs: this.now() - job.startedAt,
			...counts,
			...(treeDataError === undefined ? {} : {treeDataError}),
		});
		await this.scheduleNextRun();
	}
}
