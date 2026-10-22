import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import type {FoundDatesResponse, NodeResponse} from "../src/node-types.js";
import {nodeKeys} from "../src/client/node-cache.js";
import {undoHistory} from "../src/client/undo-history.js";

const outlineState = {
	zoomedNodeId: null,
	editingId: null,
	editingCaretOffset: null,
	editingNoteId: null,
	itemSelection: {entries: [], pivotId: null, retractableIds: [], counter: 0},
	addErrorNotification: () => "id",
};

vi.mock("../src/client/stores/outline.js", () => ({
	useOutlineStore: Object.assign(
		(selector?: (state: typeof outlineState) => unknown) => (selector ? selector(outlineState) : outlineState),
		{getState: () => outlineState},
	),
}));

const {useUpdateNode} = await import("../src/client/hooks/use-nodes.js");

function node(partial: Partial<NodeResponse> & {id: string}): NodeResponse {
	return {
		parent_id: "home",
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

function captureUpdate(queryClient: QueryClient): ReturnType<typeof useUpdateNode> {
	const captured: ReturnType<typeof useUpdateNode>[] = [];
	function Probe() {
		captured.push(useUpdateNode());
		return null;
	}
	renderToStaticMarkup(createElement(QueryClientProvider, {client: queryClient}, createElement(Probe)));
	const update = captured.at(0);
	if (update === undefined) {
		throw new Error("hook not captured");
	}
	return update;
}

const alice = node({id: "alice", name: "Alice", priority: 100});
const bob = node({id: "bob", name: "Bob", priority: 200});
const carol = node({id: "carol", parent_id: "alice", name: "Carol"});
const aliceMirror = node({id: "alice-mirror", parent_id: "dave", isMirror: true, originalNodeId: "alice"});
const foundDates: FoundDatesResponse = {items: []};

function seeded(): QueryClient {
	const queryClient = new QueryClient({defaultOptions: {mutations: {retry: false}}});
	queryClient.setQueryData(nodeKeys.detail("alice"), alice);
	queryClient.setQueryData(nodeKeys.detail("bob"), bob);
	queryClient.setQueryData(nodeKeys.children(null), [alice, bob]);
	queryClient.setQueryData(nodeKeys.children("alice"), [carol]);
	queryClient.setQueryData(nodeKeys.children("dave"), [aliceMirror]);
	queryClient.setQueryData(nodeKeys.ancestors("carol"), [alice, carol]);
	queryClient.setQueryData(nodeKeys.ancestors("bob"), [bob]);
	queryClient.setQueryData(nodeKeys.backlinks("bob"), []);
	queryClient.setQueryData(nodeKeys.foundDates("eve"), foundDates);
	queryClient.setQueryData(nodeKeys.home(), {layoutMode: "bullets"});
	return queryClient;
}

/** The cached query keys the save marked for a refetch, in the order they were seeded. */
function invalidated(queryClient: QueryClient): string[] {
	return queryClient
		.getQueryCache()
		.getAll()
		.filter((query) => query.state.isInvalidated)
		.map((query) => JSON.stringify(query.queryKey));
}

let requests: string[];

beforeEach(() => {
	undoHistory.clear();
	requests = [];
	vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
		requests.push(`${init?.method ?? "GET"} ${url}`);
		return Promise.resolve(Response.json({node: {...alice, name: "Alice <b>saved</b>", modifiedAt: 42}}));
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("saving a node's text", () => {
	it("refetches only what the text feeds and patches every cached copy with the saved node", async () => {
		const queryClient = seeded();
		captureUpdate(queryClient).mutate({nodeId: "alice", name: "Alice saved"});
		await vi.waitFor(() => {
			expect(queryClient.isMutating()).toBe(0);
		});
		const saved = {...alice, name: "Alice <b>saved</b>", modifiedAt: 42};
		expect({
			requests,
			invalidated: invalidated(queryClient),
			detail: queryClient.getQueryData(nodeKeys.detail("alice")),
			children: queryClient.getQueryData(nodeKeys.children(null)),
			ancestors: queryClient.getQueryData(nodeKeys.ancestors("carol")),
			untouched: queryClient.getQueryData(nodeKeys.children("alice")),
		}).toStrictEqual({
			requests: ["POST /api/v1/nodes/alice"],
			invalidated: [
				JSON.stringify(nodeKeys.children("dave")),
				JSON.stringify(nodeKeys.backlinks("bob")),
				JSON.stringify(nodeKeys.foundDates("eve")),
			],
			detail: saved,
			children: [saved, bob],
			ancestors: [saved, carol],
			untouched: [carol],
		});
	});
});
