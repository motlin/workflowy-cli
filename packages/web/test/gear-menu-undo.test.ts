import {describe, expect, it, vi} from "vite-plus/test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";

vi.mock("../src/client/stores/outline.js", () => ({
	useOutlineStore: (
		selector: (state: {openExportDialog: () => void; mutationCount: number; lastSavedAt: number}) => unknown,
	) => selector({openExportDialog: () => {}, mutationCount: 0, lastSavedAt: 0}),
	selectIsMutating: (state: {mutationCount: number}) => state.mutationCount > 0,
}));

/** renderToStaticMarkup reads zustand's initial state, so the seeded stack state comes through a mock. */
const undoState = {canUndo: false, canRedo: false};
vi.mock("../src/client/undo-history.js", () => ({
	useUndoStore: (selector: (state: typeof undoState) => unknown) => selector(undoState),
}));

const {GearMenu} = await import("../src/client/components/gear-menu.js");

function seed(state: typeof undoState): void {
	Object.assign(undoState, state);
}

function render(): string {
	return renderToStaticMarkup(
		createElement(GearMenu, {
			isOpen: true,
			onClose: () => {},
			onOpenSettings: () => {},
			onExpandAll: () => {},
			onCollapseAll: () => {},
			onUndo: () => {},
			onRedo: () => {},
		}),
	);
}

function row(html: string, label: string): string | undefined {
	return [...html.matchAll(/<button[^>]*>(?:(?!<\/button>).)*<\/button>/gu)]
		.map((match) => match[0])
		.find((button) => button.includes(`gear-menu-item-label">${label}<`));
}

function openTag(button: string | undefined): string | undefined {
	return button?.slice(0, button.indexOf(">") + 1);
}

describe("GearMenu undo/redo rows", () => {
	it("enables Undo and disables Redo from the undo store", () => {
		seed({canUndo: true, canRedo: false});
		const html = render();
		expect({undo: openTag(row(html, "Undo")), redo: openTag(row(html, "Redo"))}).toStrictEqual({
			undo: '<button class="gear-menu-item " type="button">',
			redo: '<button class="gear-menu-item disabled" disabled="" type="button">',
		});
	});

	it("enables Redo and disables Undo from the undo store", () => {
		seed({canUndo: false, canRedo: true});
		const html = render();
		expect({undo: openTag(row(html, "Undo")), redo: openTag(row(html, "Redo"))}).toStrictEqual({
			undo: '<button class="gear-menu-item disabled" disabled="" type="button">',
			redo: '<button class="gear-menu-item " type="button">',
		});
	});

	it("has no Save row", () => {
		const html = render();
		// "Autosaved" belongs to the status footer only, never a Save row's subtitle.
		expect({save: row(html, "Save"), autosavedSubtitle: html.includes('subtitle">Autosaved')}).toStrictEqual({
			save: undefined,
			autosavedSubtitle: false,
		});
	});
});
