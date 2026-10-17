import {beforeEach, describe, expect, it, vi} from "vite-plus/test";

vi.stubGlobal("localStorage", {getItem: () => null, setItem: () => {}});
vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: () => {}}));
vi.stubGlobal("document", {documentElement: {dataset: {}}, body: {classList: {toggle: () => true}}});
vi.stubGlobal("addEventListener", () => {});

const {shouldCommitOnBlur, useOutlineStore} = await import("../src/client/stores/outline.js");

function focusState() {
	const {editingId, editingCaretOffset, editingHeld, lastEditedId} = useOutlineStore.getState();
	return {editingId, editingCaretOffset, editingHeld, lastEditedId};
}

describe("the edited node is the only notion of focus", () => {
	beforeEach(() => {
		useOutlineStore.setState({
			editingId: null,
			editingCaretOffset: null,
			editingClickPosition: null,
			editingHeld: false,
			lastEditedId: null,
		});
	});

	it("has no separate selection state", () => {
		const state = useOutlineStore.getState();
		expect({hasSelectedId: "selectedId" in state, hasSelect: "select" in state}).toStrictEqual({
			hasSelectedId: false,
			hasSelect: false,
		});
	});

	it("remembers the last edited node after editing stops, for panels that follow it", () => {
		useOutlineStore.getState().startEditing("node-a");
		useOutlineStore.getState().stopEditing();
		expect(focusState()).toStrictEqual({
			editingId: null,
			editingCaretOffset: null,
			editingHeld: false,
			lastEditedId: "node-a",
		});
	});

	it("holds editing at the caret across a structural move, then releases it", () => {
		useOutlineStore.getState().startEditing("node-a");
		useOutlineStore.getState().holdEditing(5);
		const held = focusState();
		useOutlineStore.getState().releaseEditing();
		const released = focusState();
		expect({held, released}).toStrictEqual({
			held: {editingId: "node-a", editingCaretOffset: 5, editingHeld: true, lastEditedId: "node-a"},
			released: {editingId: "node-a", editingCaretOffset: 5, editingHeld: false, lastEditedId: "node-a"},
		});
	});

	it("resumes editing a node at a caret offset", () => {
		useOutlineStore.getState().resumeEditing("node-b", 12);
		expect(focusState()).toStrictEqual({
			editingId: "node-b",
			editingCaretOffset: 12,
			editingHeld: false,
			lastEditedId: "node-b",
		});
	});
});

describe("shouldCommitOnBlur", () => {
	it("commits and stops editing when the blurred node is still the edited one", () => {
		expect(shouldCommitOnBlur({editingId: "node-a", editingHeld: false}, "node-a")).toBe(true);
	});

	it("ignores the blur caused by a structural move that holds editing", () => {
		expect(shouldCommitOnBlur({editingId: "node-a", editingHeld: true}, "node-a")).toBe(false);
	});

	it("ignores the blur after editing was already handed to another node", () => {
		expect(shouldCommitOnBlur({editingId: "node-b", editingHeld: false}, "node-a")).toBe(false);
	});
});
