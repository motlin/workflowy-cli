import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import type {NodeResponse} from "../src/node-types.js";
import {nodeKeys} from "../src/client/node-cache.js";
import {runInUndoBatch} from "../src/client/undo-batch.js";
import {undoHistory} from "../src/client/undo-history.js";
import type {ViewState} from "../src/client/undo-history.js";

const outlineState = {
	zoomedNodeId: null,
	editingId: null,
	editingCaretOffset: null,
	editingNoteId: null,
	itemSelection: {entries: [], pivotId: null, retractableIds: [], counter: 0},
	addErrorNotification: () => "id",
	beginMutation() {},
	endMutation() {},
	startEditing() {},
};

vi.mock("../src/client/stores/outline.js", () => ({
	useOutlineStore: Object.assign(
		(selector?: (state: typeof outlineState) => unknown) => (selector ? selector(outlineState) : outlineState),
		{getState: () => outlineState},
	),
}));

const {useCreateNode, useDeleteNode, useMoveNode, useToggleComplete, useUpdateNode} =
	await import("../src/client/hooks/use-nodes.js");

function node(partial: Partial<NodeResponse> & {id: string}): NodeResponse {
	return {
		parent_id: "p",
		name: null,
		note: null,
		priority: 0,
		data: {layoutMode: null},
		createdAt: null,
		modifiedAt: null,
		completedAt: null,
		...partial,
	};
}

function useAllHooks() {
	return {
		create: useCreateNode(),
		remove: useDeleteNode(),
		move: useMoveNode(),
		toggle: useToggleComplete(),
		update: useUpdateNode(),
	};
}

/** Renders once to capture the hooks, which then mutate outside React like an event handler would. */
function captureHooks(queryClient: QueryClient): ReturnType<typeof useAllHooks> {
	const captured: ReturnType<typeof useAllHooks>[] = [];
	function Probe() {
		captured.push(useAllHooks());
		return null;
	}
	renderToStaticMarkup(createElement(QueryClientProvider, {client: queryClient}, createElement(Probe)));
	const hooks = captured.at(0);
	if (hooks === undefined) {
		throw new Error("hooks not captured");
	}
	return hooks;
}

let responses: Response[];
/** The id the create route answers with; undefined echoes the client id. */
let createdId: string | undefined;

function seeded(): QueryClient {
	const queryClient = new QueryClient({defaultOptions: {mutations: {retry: false}}});
	queryClient.setQueryData(nodeKeys.children("p"), [
		node({id: "a", priority: 100, name: "alpha"}),
		node({id: "b", priority: 200, name: "beta", completedAt: 1}),
		node({id: "c", priority: 300, name: "gamma"}),
	]);
	return queryClient;
}

async function settled(queryClient: QueryClient): Promise<void> {
	await vi.waitFor(() => {
		expect(queryClient.isMutating()).toBe(0);
	});
}

const view: ViewState = {zoomedNodeId: null, editing: null, selectedIds: []};

beforeEach(() => {
	undoHistory.clear();
	responses = [];
	createdId = undefined;
	vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
		if (url === "/api/v1/nodes" && init?.method === "POST") {
			const body = JSON.parse(typeof init.body === "string" ? init.body : "{}") as {id: string};
			return Promise.resolve(Response.json({node: node({id: createdId ?? body.id})}));
		}
		return Promise.resolve(responses.shift() ?? Response.json({node: node({id: "any"})}));
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("mutation hooks record undo ops", () => {
	it("records a delete with the slot it had before the optimistic write", async () => {
		const queryClient = seeded();
		captureHooks(queryClient).remove.mutate("b");
		await settled(queryClient);
		expect(undoHistory.popUndo()?.ops).toStrictEqual([{kind: "undelete", nodeId: "b", parentId: "p", index: 1}]);
	});

	it("records nothing when the mutation fails", async () => {
		const queryClient = seeded();
		responses.push(new Response(null, {status: 500, statusText: "Boom"}));
		captureHooks(queryClient).toggle.mutate({nodeId: "a", isCurrentlyCompleted: false});
		await settled(queryClient);
		expect(undoHistory.canUndo).toBe(false);
	});

	it("records a create under the id the server answered, at the slot asked for", async () => {
		const queryClient = seeded();
		createdId = "server-id";
		captureHooks(queryClient).create.mutate({id: "client-id", parent_id: "p", name: "", index: 1});
		await settled(queryClient);
		expect(undoHistory.popUndo()?.ops).toStrictEqual([
			{kind: "delete", nodeId: "server-id", parentId: "p", index: 1},
		]);
	});

	it("records a bottom create's slot before its optimistic row is inserted", async () => {
		const queryClient = seeded();
		captureHooks(queryClient).create.mutate({id: "n", parent_id: "p", name: ""});
		await settled(queryClient);
		expect(undoHistory.popUndo()?.ops).toStrictEqual([{kind: "delete", nodeId: "n", parentId: "p", index: 3}]);
	});

	it("records a move with its from-slot", async () => {
		const queryClient = seeded();
		responses.push(Response.json({node: node({id: "a"}), oldParentId: "p"}));
		captureHooks(queryClient).move.mutate({nodeId: "a", parent_id: "p", index: 3});
		await settled(queryClient);
		expect(undoHistory.popUndo()?.ops).toStrictEqual([
			{kind: "move", nodeId: "a", from: {parentId: "p", index: 3}, to: {parentId: "p", index: 0}},
		]);
	});

	it("joins Enter's rename and create into ONE undo step", async () => {
		const queryClient = seeded();
		const hooks = captureHooks(queryClient);
		await runInUndoBatch(
			() => view,
			() => {
				hooks.update.mutate({nodeId: "a", name: "al"});
				hooks.create.mutate({id: "n", parent_id: "p", name: "pha", index: 1});
			},
		);
		await settled(queryClient);
		expect(undoHistory.popUndo()?.ops).toStrictEqual([
			{kind: "delete", nodeId: "n", parentId: "p", index: 1},
			{kind: "edit", nodeId: "a", field: "name", before: "al", after: "alpha"},
		]);
		expect(undoHistory.canUndo).toBe(false);
	});
});
