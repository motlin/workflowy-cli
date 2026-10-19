import {describe, expect, it, vi} from "vite-plus/test";

vi.mock("../src/client/stores/outline.js", () => ({
	shouldCommitOnBlur: () => true,
	isModalOpen: () => false,
	registerEditFlush: () => () => {},
	useOutlineStore: Object.assign(() => {}, {getState: () => ({})}),
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

const {tagClickQuery} = await import("../src/client/components/editable-text.js");

describe("tagClickQuery", () => {
	it("searches for the clicked tag with a trailing space, and clears the search when it is already active", () => {
		expect({
			fresh: tagClickQuery("#fruitTag", ""),
			active: tagClickQuery("#fruitTag", "#fruitTag "),
			other: tagClickQuery("@bob", "#fruitTag "),
		}).toStrictEqual({fresh: "#fruitTag ", active: "", other: "@bob "});
	});
});
