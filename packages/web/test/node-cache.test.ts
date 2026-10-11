import {QueryClient} from "@tanstack/react-query";
import {describe, expect, it} from "vite-plus/test";
import {nodeKeys, readChildren, readDetail} from "../src/client/node-cache.js";
import type {NodeResponse} from "../src/node-types.js";

describe("nodeKeys", () => {
	it("builds stable, namespaced keys", () => {
		expect(nodeKeys.all).toStrictEqual(["nodes"]);
		expect(nodeKeys.children("p")).toStrictEqual(["nodes", "children", "p"]);
		expect(nodeKeys.children(null)).toStrictEqual(["nodes", "children", null]);
		expect(nodeKeys.detail("n")).toStrictEqual(["nodes", "detail", "n"]);
		expect(nodeKeys.ancestors("n")).toStrictEqual(["nodes", "ancestors", "n"]);
	});
});

describe("readChildren / readDetail", () => {
	it("reads through the matching key", () => {
		const qc = new QueryClient();
		const kids: NodeResponse[] = [
			{
				id: "a",
				parent_id: "parent",
				name: "a",
				note: null,
				priority: 0,
				data: {layoutMode: null},
				createdAt: null,
				modifiedAt: null,
				completedAt: null,
			},
		];
		qc.setQueryData(nodeKeys.children("parent"), kids);
		qc.setQueryData(nodeKeys.detail("n"), {id: "n"});

		expect(readChildren(qc, "parent")).toBe(kids);
		expect(readDetail(qc, "n")).toStrictEqual({id: "n"});
	});

	it("returns undefined on a cache miss", () => {
		const qc = new QueryClient();
		expect(readChildren(qc, "absent")).toBeUndefined();
		expect(readDetail(qc, "absent")).toBeUndefined();
	});
});
