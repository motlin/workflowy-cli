// @vitest-environment happy-dom
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {act, createElement} from "react";
import {createRoot} from "react-dom/client";
import type {Root} from "react-dom/client";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter} from "react-router-dom";
import type {NodeResponse} from "../src/node-types.js";
import {nodeKeys} from "../src/client/node-cache.js";
import {StableNavigateProvider} from "../src/client/hooks/use-stable-navigate.js";
import {useZoomTo} from "../src/client/hooks/use-zoom-to.js";
import {useOutlineStore} from "../src/client/stores/outline.js";

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const ALICE = "4823cefa-5fc0-478c-88ac-aaaaaaaaaaaa";
const BOB = "9a1f6c2e-0b7d-4e5a-8c3f-bbbbbbbbbbbb";

const alice: NodeResponse = {
	id: ALICE,
	parent_id: null,
	name: "alice",
	note: null,
	priority: 100,
	data: {layoutMode: null},
	createdAt: null,
	modifiedAt: null,
	completedAt: null,
};
const bob: NodeResponse = {...alice, id: BOB, parent_id: ALICE, name: "bob"};

let root: Root | undefined;
let releaseBacklinks: () => void = () => {};

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	useOutlineStore.setState(useOutlineStore.getInitialState(), true);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			if (url.endsWith("/backlinks")) {
				await new Promise<void>((resolve) => {
					releaseBacklinks = resolve;
				});
			}
			return Response.json({rootId: null, items: []});
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

describe("useZoomTo", () => {
	it("swaps to the new zoom once its Backlinks section has loaded, then edits its first child after that paint", async () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(nodeKeys.children(null), [alice]);
		queryClient.setQueryData(nodeKeys.children(ALICE), [bob]);
		const probe: {zoomTo?: ReturnType<typeof useZoomTo>} = {};
		function Probe({capture}: {capture: (zoomTo: ReturnType<typeof useZoomTo>) => void}) {
			capture(useZoomTo());
			return null;
		}
		root = createRoot(document.createElement("div"));
		act(() => {
			root?.render(
				createElement(
					QueryClientProvider,
					{client: queryClient},
					createElement(
						MemoryRouter,
						null,
						createElement(
							StableNavigateProvider,
							null,
							createElement(Probe, {
								capture: (zoomTo) => {
									probe.zoomTo = zoomTo;
								},
							}),
						),
					),
				),
			);
		});
		let zoomed: Promise<void> | undefined;
		await act(async () => {
			zoomed = probe.zoomTo?.(ALICE, "first_child");
			await vi.waitFor(() => {
				expect(queryClient.isFetching({queryKey: nodeKeys.backlinks(ALICE)})).toBe(1);
			});
		});
		const beforeBacklinks = useOutlineStore.getState().zoomedNodeId;
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
		await act(async () => {
			releaseBacklinks();
			await vi.waitFor(() => {
				expect(useOutlineStore.getState().zoomedNodeId).toBe(ALICE);
			});
		});
		const editingAtSwap = useOutlineStore.getState().editingId;
		await act(async () => {
			for (const frame of frames.splice(0)) {
				frame(0);
			}
			await zoomed;
		});
		expect({
			beforeBacklinks,
			editingAtSwap,
			editingAfterPaint: useOutlineStore.getState().editingId,
		}).toStrictEqual({beforeBacklinks: null, editingAtSwap: null, editingAfterPaint: BOB});
	});
});
