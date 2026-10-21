// @vitest-environment happy-dom
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {act, createElement} from "react";
import {createRoot} from "react-dom/client";
import type {Root} from "react-dom/client";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {EditableText} from "../src/client/components/editable-text.js";
import {useOutlineStore} from "../src/client/stores/outline.js";

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | undefined;

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	useOutlineStore.setState(useOutlineStore.getInitialState(), true);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Promise.resolve(Response.json({}))),
	);
});

afterEach(() => {
	act(() => {
		root?.unmount();
	});
	root = undefined;
	vi.unstubAllGlobals();
});

/** The query keys mounting one row name puts in the cache. */
function mountedQueryKeys(isEditing: boolean): string[] {
	const queryClient = new QueryClient();
	root = createRoot(document.createElement("div"));
	act(() => {
		root?.render(
			createElement(
				QueryClientProvider,
				{client: queryClient},
				createElement(EditableText, {
					nodeId: "alice",
					initialValue: "Alice",
					parentId: null,
					priority: 0,
					isEditing,
				}),
			),
		);
	});
	return queryClient
		.getQueryCache()
		.getAll()
		.map((query) => String(query.queryKey[0]));
}

describe("EditableText at rest", () => {
	it("mounts a resting row with only the date settings it renders pills with, leaving the editor's queries to the edited row", () => {
		const resting = mountedQueryKeys(false);
		act(() => {
			root?.unmount();
		});
		expect({resting, editing: mountedQueryKeys(true)}).toStrictEqual({
			resting: ["preferences"],
			editing: ["preferences", "tag-autocomplete"],
		});
	});
});
