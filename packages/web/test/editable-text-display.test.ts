import {describe, expect, it, vi} from "vite-plus/test";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";

const outlineState = {};

vi.mock("../src/client/stores/outline.js", () => ({
	shouldCommitOnBlur: () => true,
	useOutlineStore: Object.assign(
		(selector?: (state: typeof outlineState) => unknown) => (selector ? selector(outlineState) : outlineState),
		{getState: () => outlineState},
	),
}));
vi.mock("../src/client/hooks/use-nodes.js", () => ({
	useCreateNode: () => ({mutate: () => {}}),
	useDeleteNode: () => ({mutate: () => {}}),
	useMoveNode: () => ({mutate: () => {}}),
	useUpdateNode: () => ({mutate: () => {}}),
}));
vi.mock("../src/client/hooks/use-tag-colors.js", () => ({
	useRemoveTagColor: () => ({mutate: () => {}}),
	useSetTagColor: () => ({mutate: () => {}}),
	useTagColors: () => ({}),
}));

const {EditableText} = await import("../src/client/components/editable-text.js");

function render(initialValue: string, isEditing: boolean): string {
	return renderToStaticMarkup(
		createElement(
			QueryClientProvider,
			{client: new QueryClient()},
			createElement(EditableText, {nodeId: "alice", initialValue, parentId: null, priority: 0, isEditing}),
		),
	);
}

describe("EditableText display markup", () => {
	it("renders a stored link with upstream's contentLink markup", () => {
		expect(render('Go <a href="https://example.com/">#taSite</a>', false)).toBe(
			'<span class="innerContentContainer" data-node-id="alice" role="presentation">Go <a class="contentLink" target="_blank" rel="noreferrer" href="https://example.com/">#taSite</a></span>',
		);
	});
});
