// @vitest-environment happy-dom
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import type {Root} from "react-dom/client";
import type {NodeResponse, OutlineViewResponse} from "../src/node-types.js";

declare global {
	// React reads this to know act() wraps every update.
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const {act, createElement} = await import("react");
const {createRoot} = await import("react-dom/client");
const {QueryClient, QueryClientProvider} = await import("@tanstack/react-query");
const {MemoryRouter} = await import("react-router-dom");
const {OutlineView} = await import("../src/client/app.js");
const {useOutlineStore} = await import("../src/client/stores/outline.js");

function row(id: string, parentId: string | null, hasChildren: boolean): NodeResponse {
	return {
		id,
		parent_id: parentId,
		name: id,
		note: null,
		priority: 0,
		data: {layoutMode: null},
		completedAt: null,
		createdAt: 0,
		modifiedAt: 0,
		hasChildren,
		hasUncompletedChildren: hasChildren,
	};
}

const NO_BACKLINKS = {rootId: null, items: []};

// Home holds alice > bob > carol, alice and bob expanded.
const view: OutlineViewResponse = {
	lists: [
		{parentId: null, nodes: [row("alice", null, true)], backlinks: null},
		{parentId: "alice", nodes: [row("bob", "alice", true)], backlinks: NO_BACKLINKS},
		{parentId: "bob", nodes: [row("carol", "bob", false)], backlinks: NO_BACKLINKS},
	],
};

let root: Root | undefined;
let requests: string[] = [];

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	requests = [];
	useOutlineStore.setState(useOutlineStore.getInitialState(), true);
	useOutlineStore.setState({expandedIds: new Set(["alice", "bob"])});
	vi.stubGlobal(
		"fetch",
		vi.fn<typeof fetch>(async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			requests.push(url);
			return Promise.resolve(
				url.endsWith("/api/v1/nodes/view") ? Response.json(view) : Response.json({}, {status: 404}),
			);
		}),
	);
});

afterEach(() => {
	act(() => {
		root?.unmount();
	});
	root = undefined;
	vi.unstubAllGlobals();
});

describe("outline view load", () => {
	it("loads a three-level expanded view in one request and mounts every level in the same commit", async () => {
		const container = document.createElement("div");
		document.body.append(container);
		// Each mutation batch is one React commit: the rows shown after each.
		const commits: string[][] = [];
		const observer = new MutationObserver(() => {
			const ids = [...container.querySelectorAll("[data-node-id]")].map((element) =>
				element.getAttribute("data-node-id"),
			);
			commits.push([...new Set(ids.filter((id) => id !== null))]);
		});
		observer.observe(container, {childList: true, subtree: true});
		// The app's staleTime, so seeded lists do not refetch on mount.
		const queryClient = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: 60_000}}});
		root = createRoot(container);
		act(() => {
			root?.render(
				createElement(
					QueryClientProvider,
					{client: queryClient},
					createElement(MemoryRouter, null, createElement(OutlineView)),
				),
			);
		});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 50);
			});
		});
		observer.disconnect();

		expect({
			firstWithRows: commits.find((ids) => ids.length > 0),
			treeRequests: requests.filter((url) => url.includes("/children") || url.endsWith("/backlinks")),
			viewRequests: requests.filter((url) => url.endsWith("/api/v1/nodes/view")).length,
		}).toStrictEqual({
			firstWithRows: ["alice", "bob", "carol"],
			treeRequests: [],
			viewRequests: 1,
		});
	});
});
