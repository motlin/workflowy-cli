import {describe, expect, it} from "vite-plus/test";
import DatabaseConstructor from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {Hono} from "hono";
import {join} from "node:path";
import * as schema from "@workflowy/shared/db";
import {formatTemporalTimestamp} from "@workflowy/shared/temporal";
import type {WorkflowyNode} from "@workflowy/shared/types";
import type {AppEnv, ServerContext} from "../src/server/context.js";
import type {NodeChangesResponse} from "../src/node-types.js";
import {httpAppFor} from "./http-app-for.js";

const {CacheService} = await import("@workflowy/shared/cache");
const {nodesRouter} = await import("../src/server/routes/nodes.js");

const migrationsFolder = join(import.meta.dirname, "../../shared/src/db/migrations");

function apiNode(id: string, parentId: string | null, priority: number): WorkflowyNode {
	return {id, name: id, note: null, parent_id: parentId, priority, createdAt: 100, modifiedAt: 200, completed: false};
}

/** Home holds `parents` parents P0.., each with two children. */
function setup(parents: number) {
	const sqlite = new DatabaseConstructor(":memory:");
	let statements = 0;
	const db = drizzle(sqlite, {
		schema,
		logger: {
			logQuery() {
				statements += 1;
			},
		},
	});
	migrate(db, {migrationsFolder});
	const cacheService = new CacheService(db);
	for (let p = 0; p < parents; p++) {
		cacheService.insertNode(apiNode(`P${p}`, null, p), null);
		for (let k = 0; k < 2; k++) {
			cacheService.insertNode(apiNode(`P${p}c${k}`, `P${p}`, k), `P${p}`);
		}
	}
	const ctx = {db, cacheService} as unknown as ServerContext;
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => {
		c.set("ctx", ctx);
		await next();
	});
	app.route("/", httpAppFor(ctx));
	app.route("/api/v1/nodes", nodesRouter);
	const changes = async (since: string | null) => {
		const before = statements;
		const query = since === null ? "" : `?since=${encodeURIComponent(since)}`;
		const res = await app.fetch(new Request(`http://x/api/v1/nodes/changes${query}`));
		const body = (await res.json()) as NodeChangesResponse;
		return {status: res.status, body, statements: statements - before};
	};
	return {cacheService, changes};
}

/**
 * A `since` that skips the server's look-back window, so only writes after the mark `latest` come back: the server
 * re-reads a few seconds before any mark, which would otherwise answer the setup's own writes too.
 */
function pastLookBack(latest: string): string {
	return formatTemporalTimestamp(new Date(Date.parse(`${latest.replace(" ", "T")}Z`) + 5000));
}

/** A response reduced to what a test compares: id sets, and each list as parent -> child ids. */
function shape(body: NodeChangesResponse) {
	return {
		reset: body.reset,
		changedIds: new Set(body.changedIds),
		deletedIds: new Set(body.deletedIds),
		children: Object.fromEntries(
			body.children.map(({parentId, nodes}) => [parentId ?? "home", nodes.map((node) => node.id)]),
		),
	};
}

describe("GET /api/v1/nodes/changes", () => {
	it("without since answers only the high-water mark", async () => {
		const {changes} = setup(1);

		const {status, body} = await changes(null);

		expect({status, latest: body.latest.length > 0, ...shape(body)}).toStrictEqual({
			status: 200,
			latest: true,
			reset: false,
			changedIds: new Set(),
			deletedIds: new Set(),
			children: {},
		});
	});

	it("answers a created node with its parent's refreshed children", async () => {
		const {cacheService, changes} = setup(2);
		const seeded = await changes(null);
		cacheService.insertNode(apiNode("New", "P1", 5), "P1");

		const {body} = await changes(pastLookBack(seeded.body.latest));

		expect(shape(body)).toStrictEqual({
			reset: false,
			changedIds: new Set(["New"]),
			deletedIds: new Set(),
			children: {P1: ["P1c0", "P1c1", "New"]},
		});
		expect(body.latest >= seeded.body.latest).toBe(true);
	});

	it("answers a moved node with both its old and new parents' children", async () => {
		const {cacheService, changes} = setup(2);
		const seeded = await changes(null);
		cacheService.insertNode(apiNode("P0c1", "P1", 5), "P1");

		const {body} = await changes(pastLookBack(seeded.body.latest));

		expect(shape(body)).toStrictEqual({
			reset: false,
			changedIds: new Set(["P0c1"]),
			deletedIds: new Set(),
			children: {P0: ["P0c0"], P1: ["P1c0", "P1c1", "P0c1"]},
		});
	});

	it("answers a deleted node as deleted, with its parent's children", async () => {
		const {cacheService, changes} = setup(2);
		const seeded = await changes(null);
		cacheService.deleteNode("P1c0");

		const {body} = await changes(pastLookBack(seeded.body.latest));

		expect(shape(body)).toStrictEqual({
			reset: false,
			changedIds: new Set(["P1c0"]),
			deletedIds: new Set(["P1c0"]),
			children: {P1: ["P1c1"]},
		});
	});

	it("keeps its statement count independent of how many parents changed", async () => {
		const run = async (parents: number) => {
			const {cacheService, changes} = setup(parents);
			const seeded = await changes(null);
			for (let p = 0; p < parents; p++) {
				cacheService.insertNode(apiNode(`New${p}`, `P${p}`, 5), `P${p}`);
			}
			return changes(seeded.body.latest);
		};

		const few = await run(2);
		const many = await run(12);

		expect({
			few: Object.keys(shape(few.body).children).length,
			many: Object.keys(shape(many.body).children).length,
			same: few.statements === many.statements,
		}).toStrictEqual({few: 3, many: 13, same: true});
		expect(many.statements).toBeLessThanOrEqual(40);
	});
});
