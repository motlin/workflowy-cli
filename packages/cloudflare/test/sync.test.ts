import {afterAll, describe, expect, it} from "vite-plus/test";
import {rmSync} from "node:fs";
import {readJson, startHarness} from "./harness";
import type {Harness} from "./harness";

const sleep = async (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

function uuid(n: number): string {
	return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function makeNodes(count: number, rename = new Map<number, string>()) {
	return Array.from({length: count}, (_, i) => ({
		id: uuid(i + 1),
		name: rename.get(i) ?? `node ${i}`,
		note: null,
		parent_id: i < 10 ? null : uuid((i % 10) + 1),
		priority: i,
		createdAt: 1000 + i,
		modifiedAt: 2000 + i,
	}));
}

interface SyncStatus {
	phase: string;
	applied: number;
	nextAlarmAt: number | null;
	lastResult: {
		status: string;
		totalNodes?: number;
		nodesAdded?: number;
		nodesUpdated?: number;
		nodesUnchanged?: number;
		nodesPhasedOut?: number;
		exportKey?: string;
	} | null;
}

const bindings = {
	ACCESS_DEV_IDENTITY: "dev",
	WORKFLOWY_API_KEY: "fake-key-value",
	WORKFLOWY_API_URL: "http://upstream.test",
};

async function status(h: Harness): Promise<SyncStatus> {
	const response = await h.mf.dispatchFetch("http://localhost/api/admin/sync");
	expect(response.status).toBe(200);
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test reads its own endpoint
	return (await readJson(response)) as SyncStatus;
}

async function runToIdle(h: Harness, previousFinished = 0): Promise<SyncStatus> {
	const post = await h.mf.dispatchFetch("http://localhost/api/admin/sync", {method: "POST"});
	expect(post.status).toBe(202);
	for (let i = 0; i < 300; i++) {
		const current = await status(h);
		if (
			current.phase === "idle" &&
			current.lastResult !== null &&
			current.applied === 0 &&
			(i > 0 || previousFinished === 0)
		) {
			return current;
		}
		await sleep(100);
	}
	throw new Error("sync did not finish");
}

async function liveIds(h: Harness): Promise<string[]> {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Miniflare types its namespace with undici classes
	const ns = (await h.mf.getDurableObjectNamespace("USER_STORE")) as unknown as DurableObjectNamespace;
	const response = await ns.get(ns.idFromName("dev")).fetch("http://localhost/__live-ids");
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test reads its own endpoint
	return response.json();
}

describe("sync from a fake upstream", () => {
	let current = makeNodes(5000);
	let exportCalls = 0;
	let rateLimit = false;
	const auths: (string | null)[] = [];
	const open = new Set<Harness>();
	const stop = async (h: Harness, keepData = false): Promise<void> => {
		open.delete(h);
		await h.dispose(keepData);
	};
	const start = async (persistDir?: string, extra: Record<string, string> = {}): Promise<Harness> => {
		const started = await startHarness(
			"./probe-entry.ts",
			"ProbeStore",
			persistDir,
			{...bindings, ...extra},
			{
				outboundService: (request: Request): Response => {
					const url = new URL(request.url);
					if (url.pathname === "/api/v1/nodes-export") {
						exportCalls++;
						auths.push(request.headers.get("authorization"));
						if (rateLimit) {
							return new Response("slow down", {status: 429, headers: {"retry-after": "120"}});
						}
						return Response.json({nodes: current});
					}
					return new Response(`unexpected ${url.pathname}`, {status: 500});
				},
			},
		);
		open.add(started);
		return started;
	};
	afterAll(async () => {
		await Promise.all([...open].map(async (h) => stop(h)));
	});

	it("imports a 5k-node export, keeps a raw copy in R2, then reports no changes and phases out a removed node", async () => {
		const h = await start();
		const first = await runToIdle(h);
		expect(first.lastResult).toMatchObject({
			status: "ok",
			totalNodes: 5000,
			nodesAdded: 5000,
			nodesUnchanged: 0,
			nodesPhasedOut: 0,
		});
		expect(auths).toStrictEqual(["Bearer fake-key-value"]);
		await expect(liveIds(h)).resolves.toHaveLength(5000);

		const exportKey = first.lastResult?.exportKey ?? "";
		expect(exportKey).toMatch(/^exports\/.+\.json$/u);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Miniflare types its bucket with undici classes
		const bucket = (await h.mf.getR2Bucket("SNAPSHOTS")) as unknown as R2Bucket;
		const stored = await bucket.get(exportKey);
		expect(JSON.parse((await stored?.text()) ?? "null")).toStrictEqual({nodes: current});

		const second = await runToIdle(h, 1);
		expect(second.lastResult).toMatchObject({status: "ok", nodesAdded: 0, nodesUpdated: 0, nodesUnchanged: 5000});

		current = makeNodes(5000, new Map([[20, "renamed"]])).slice(0, 4999);
		const third = await runToIdle(h, 2);
		expect(third.lastResult).toMatchObject({status: "ok", nodesUpdated: 1, nodesPhasedOut: 1});
		await expect(liveIds(h)).resolves.toHaveLength(4999);
		expect(third.nextAlarmAt).toBeGreaterThan(Date.now() + 25 * 60_000);
	}, 180_000);

	it("backs off on a 429 without losing state", async () => {
		const h = await start();
		rateLimit = true;
		const before = exportCalls;
		const post = await h.mf.dispatchFetch("http://localhost/api/admin/sync", {method: "POST"});
		expect(post.status).toBe(202);
		let result: SyncStatus | undefined;
		for (let i = 0; i < 100; i++) {
			result = await status(h);
			if (result.lastResult?.status === "rate_limited") {
				break;
			}
			await sleep(100);
		}
		expect(result?.lastResult?.status).toBe("rate_limited");
		expect(exportCalls).toBe(before + 1);
		expect(result?.nextAlarmAt).toBeGreaterThan(Date.now() + 100_000);
		rateLimit = false;
		await stop(h);
	}, 120_000);

	it("resumes after the object restarts between batches", async () => {
		current = makeNodes(5000);
		const first = await start(undefined, {SYNC_BATCHES_PER_TICK: "1", SYNC_TICK_DELAY_MS: "600000"});
		const persistDir = first.persistDir;
		await first.mf.dispatchFetch("http://localhost/api/admin/sync", {method: "POST"});
		let parked: SyncStatus | undefined;
		for (let i = 0; i < 100; i++) {
			parked = await status(first);
			if (parked.applied > 0) {
				break;
			}
			await sleep(100);
		}
		expect(parked).toMatchObject({phase: "importing", applied: 2000});
		const callsBefore = exportCalls;
		await stop(first, true);

		const second = await start(persistDir, {SYNC_BATCHES_PER_TICK: "1", SYNC_TICK_DELAY_MS: "0"});
		await second.mf.dispatchFetch("http://localhost/api/admin/sync", {method: "POST"});
		let done: SyncStatus | undefined;
		for (let i = 0; i < 300; i++) {
			done = await status(second);
			if (done.phase === "idle" && done.lastResult?.status === "ok") {
				break;
			}
			await sleep(100);
		}
		expect(done?.lastResult).toMatchObject({status: "ok", totalNodes: 5000, nodesAdded: 5000, nodesPhasedOut: 0});
		expect(exportCalls).toBe(callsBefore);
		await expect(liveIds(second)).resolves.toHaveLength(5000);
		await stop(second);
		rmSync(persistDir, {recursive: true, force: true});
	}, 180_000);
});
