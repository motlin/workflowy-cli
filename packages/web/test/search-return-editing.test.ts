import {beforeEach, describe, expect, it, vi} from "vite-plus/test";

vi.stubGlobal("localStorage", {getItem: () => null, setItem: () => {}});
vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: () => {}}));
vi.stubGlobal("document", {documentElement: {dataset: {}}, body: {classList: {toggle: () => true}}});
vi.stubGlobal("addEventListener", () => {});

const {useOutlineStore} = await import("../src/client/stores/outline.js");

function editingState() {
	const {editingId, editingCaretOffset, lastEditedId, searchPanelOpen, searchReturn} = useOutlineStore.getState();
	return {editingId, editingCaretOffset, lastEditedId, searchPanelOpen, searchReturn};
}

describe("Escape while editing opens search and returns to the edited node", () => {
	beforeEach(() => {
		useOutlineStore.setState({
			editingId: null,
			editingCaretOffset: null,
			editingClickPosition: null,
			lastEditedId: null,
			searchPanelOpen: false,
			searchInitialQuery: null,
			searchReturn: null,
		});
	});

	it("remembers the edited node and caret, then restores editing when search is dismissed", () => {
		const {startEditing} = useOutlineStore.getState();
		startEditing("node-a");
		useOutlineStore.getState().openSearchFromEditing("node-a", 7);
		const opened = editingState();
		useOutlineStore.getState().dismissSearchPanel();
		const dismissed = editingState();
		expect({opened, dismissed}).toStrictEqual({
			opened: {
				editingId: null,
				editingCaretOffset: null,
				lastEditedId: "node-a",
				searchPanelOpen: true,
				searchReturn: {nodeId: "node-a", caretOffset: 7},
			},
			dismissed: {
				editingId: "node-a",
				editingCaretOffset: 7,
				lastEditedId: "node-a",
				searchPanelOpen: false,
				searchReturn: null,
			},
		});
	});

	it("does not restore editing when search closes by choosing a result", () => {
		useOutlineStore.getState().openSearchFromEditing("node-a", 3);
		useOutlineStore.getState().toggleSearchPanel();
		expect(editingState()).toStrictEqual({
			editingId: null,
			editingCaretOffset: null,
			lastEditedId: "node-a",
			searchPanelOpen: false,
			searchReturn: null,
		});
	});

	it("dismissing search that was not opened from editing just closes it", () => {
		useOutlineStore.getState().toggleSearchPanel();
		useOutlineStore.getState().dismissSearchPanel();
		expect(editingState()).toStrictEqual({
			editingId: null,
			editingCaretOffset: null,
			lastEditedId: null,
			searchPanelOpen: false,
			searchReturn: null,
		});
	});

	it("starting a fresh edit clears any restored caret offset", () => {
		useOutlineStore.getState().openSearchFromEditing("node-a", 4);
		useOutlineStore.getState().dismissSearchPanel();
		useOutlineStore.getState().startEditing("node-b");
		expect(editingState()).toStrictEqual({
			editingId: "node-b",
			editingCaretOffset: null,
			lastEditedId: "node-b",
			searchPanelOpen: false,
			searchReturn: null,
		});
	});
});
