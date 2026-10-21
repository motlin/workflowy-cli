// @vitest-environment happy-dom
import {afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";
import type {Root} from "react-dom/client";

declare global {
	// React reads this to know act() wraps every update.
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

vi.mock("../src/client/hooks/use-nodes.js", () => ({
	useCreateNode: () => ({mutate: () => {}}),
	useDeleteNode: () => ({mutate: () => {}}),
	useMoveNode: () => ({mutate: () => {}}),
	useUpdateNode: () => ({mutate: () => {}}),
}));
vi.mock("../src/client/hooks/use-commit-search.js", () => ({useCommitSearch: () => () => {}}));
vi.mock("../src/client/hooks/use-tag-colors.js", () => ({
	useRemoveTagColor: () => ({mutate: () => {}}),
	useSetTagColor: () => ({mutate: () => {}}),
	useTagColors: () => ({"@ellen": "red"}),
}));

const {act, createElement} = await import("react");
const {createRoot} = await import("react-dom/client");
const {QueryClient, QueryClientProvider} = await import("@tanstack/react-query");
const {EditableText} = await import("../src/client/components/editable-text.js");
const {caretTextOffset, placeCaretAtTextOffset} = await import("../src/client/caret-dom.js");

let root: Root | undefined;

beforeAll(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
	act(() => {
		root?.unmount();
	});
	document.body.innerHTML = "";
});

function mountEditor(initialValue: string): HTMLElement {
	const container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root?.render(
			createElement(
				QueryClientProvider,
				{client: new QueryClient()},
				createElement(EditableText, {
					nodeId: "alice",
					initialValue,
					parentId: null,
					priority: 0,
					isEditing: true,
				}),
			),
		);
	});
	const editor = container.querySelector<HTMLElement>(".innerContentContainer.editing");
	if (editor === null) {
		throw new Error("editor did not render");
	}
	return editor;
}

/** Simulate the browser inserting `data` at the caret: the DOM text changes, then `input` fires. */
function typeText(editor: HTMLElement, text: string, data: string): void {
	editor.textContent = text;
	placeCaretAtTextOffset(editor, text.length);
	act(() => {
		editor.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data}));
	});
}

function tagsIn(editor: HTMLElement): {val: string | undefined; text: string}[] {
	return [...editor.querySelectorAll<HTMLElement>(".contentTag")].map((tag) => ({
		val: tag.dataset.val,
		text: tag.textContent,
	}));
}

describe("EditableText typed tag styling", () => {
	it("renders stored tags as contentTag spans while editing", () => {
		const editor = mountEditor("Hi @Ellen there");
		expect(tagsIn(editor)).toStrictEqual([{val: "@ellen", text: "@Ellen"}]);
	});

	it("styles a typed mention in the same input event as the space that completes it", () => {
		const editor = mountEditor("Hi");
		typeText(editor, "Hi @Ellen", "n");
		expect(tagsIn(editor)).toStrictEqual([]);
		typeText(editor, "Hi @Ellen ", " ");
		expect({tags: tagsIn(editor), text: editor.textContent, caret: caretTextOffset(editor)}).toStrictEqual({
			tags: [{val: "@ellen", text: "@Ellen"}],
			text: "Hi @Ellen ",
			caret: 10,
		});
	});
});
