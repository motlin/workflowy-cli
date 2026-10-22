// @vitest-environment happy-dom
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import type {Root} from "react-dom/client";
import {renders} from "./helpers/render-counter.js";
import type {NodeResponse} from "../src/node-types.js";

declare global {
	// React reads this to know act() wraps every update.
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const {act, createElement} = await import("react");
const {createRoot} = await import("react-dom/client");
const {QueryClient, QueryClientProvider} = await import("@tanstack/react-query");
const {MemoryRouter} = await import("react-router-dom");
const {OutlineRow} = await import("../src/client/components/outline-node.js");
const {useOutlineStore} = await import("../src/client/stores/outline.js");

function restingRow(hasChildren: boolean): NodeResponse {
	return {
		id: "alice",
		parent_id: null,
		name: "Alice",
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

let root: Root | undefined;

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	useOutlineStore.setState(useOutlineStore.getInitialState(), true);
	vi.stubGlobal(
		"fetch",
		vi.fn<typeof fetch>(async () => Promise.resolve(Response.json({}, {status: 404}))),
	);
});

afterEach(() => {
	act(() => {
		root?.unmount();
	});
	root = undefined;
	vi.unstubAllGlobals();
});

/** The test's providers, which mount alongside the row. */
const PROVIDERS = {QueryClientProvider: 1, MemoryRouter: 1, Router: 1};

/** Components rendered, by name, mounting one row. */
function mountRenders(node: NodeResponse): Record<string, number> {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	root = createRoot(document.createElement("div"));
	renders.clear();
	act(() => {
		root?.render(
			createElement(
				QueryClientProvider,
				{client: queryClient},
				createElement(MemoryRouter, null, createElement(OutlineRow, {node})),
			),
		);
	});
	return Object.fromEntries(renders);
}

describe("resting OutlineRow components", () => {
	it("mounts a resting leaf row as three components: the row, its name, and its resting text", () => {
		expect(mountRenders(restingRow(false))).toStrictEqual({
			...PROVIDERS,
			OutlineRow: 1,
			NodeName: 1,
			RestingText: 1,
		});
	});

	it("mounts a resting collapsed parent row as the same three components", () => {
		expect(mountRenders(restingRow(true))).toStrictEqual({
			...PROVIDERS,
			OutlineRow: 1,
			NodeName: 1,
			RestingText: 1,
		});
	});
});
