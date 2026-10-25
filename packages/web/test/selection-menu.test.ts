// @vitest-environment happy-dom
import {afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";
import type {Root} from "react-dom/client";
import type {CommandContext} from "../src/client/keys/dispatch.js";
import {selectionOf} from "../src/client/item-selection.js";

declare global {
	// React reads this to know act() wraps every update.
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const executed: {id: string; ctx: CommandContext}[] = [];
const registry = Object.fromEntries(
	[
		"toggle_h1",
		"toggle_h2",
		"toggle_h3",
		"toggle_paragraph",
		"toggle_code_block",
		"toggle_quote_block",
		"toggle_bullet",
		"toggle_numbered",
		"complete",
		"move_to",
		"show_export",
		"delete",
	].map((id) => [
		id,
		{
			execute: (ctx: CommandContext) => {
				executed.push({id, ctx});
			},
		},
	]),
);

vi.mock("../src/client/hooks/use-global-keymap.js", () => ({activeCommandRegistry: () => registry}));
vi.mock("../src/client/hooks/use-selection-keymap.js", () => ({
	currentSelectionView: () => ({
		tree: {
			zoomRootId: "R",
			parentOf: (id: string) => (id === "R" ? null : "R"),
			visibleOrder: ["R", "Alpha", "Bravo", "Charlie", "Delta"],
			nextPotentiallyVisibleSiblingOf: () => null,
			previousPotentiallyVisibleSiblingOf: () => null,
		},
		rows: ["Alpha", "Bravo", "Charlie", "Delta"].map((id) => ({id, parentId: "R"})),
		allIds: [],
	}),
}));
vi.mock("../src/client/node-cache.js", () => ({
	readNode: (_client: unknown, id: string) => ({id, parent_id: "R", data: {layoutMode: null}, completedAt: null}),
}));
vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({getQueryCache: () => ({subscribe: () => () => {}})}),
}));

const {act, createElement} = await import("react");
const {createRoot} = await import("react-dom/client");
const {SelectionMenu, SelectionMenuView} = await import("../src/client/components/selection-menu.js");
const {useOutlineStore} = await import("../src/client/stores/outline.js");

let root: Root | undefined;
let host: HTMLElement | undefined;

beforeAll(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
	act(() => {
		root?.unmount();
	});
	host?.remove();
	document.body.innerHTML = "";
	executed.length = 0;
	useOutlineStore.getState().clearItemSelection();
});

function addRow(id: string): void {
	const project = document.createElement("div");
	project.className = "project";
	project.innerHTML = `<div class="innerContentContainer" data-node-id="${id}"></div>`;
	document.body.append(project);
}

function mount(element: ReturnType<typeof createElement>): void {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	act(() => {
		root?.render(element);
	});
}

function menu(): HTMLElement | null {
	return document.querySelector<HTMLElement>(".selection-menu");
}

function rowLabels(): string[] {
	return [...document.querySelectorAll<HTMLElement>(".selection-menu [data-handbook]")].map(
		(row) => row.dataset.handbook ?? "",
	);
}

const LOCAL_ORDER = [
	"toggle_h1",
	"toggle_h2",
	"toggle_h3",
	"toggle_paragraph",
	"toggle_code_block",
	"toggle_quote_block",
	"toggle_bullet",
	"toggle_numbered",
	"complete",
	"move_to",
	"show_export",
	"delete",
];

describe("SelectionMenu", () => {
	it("renders one menu with upstream's class template, the registered rows and the item count", () => {
		["Alpha", "Bravo", "Charlie", "Delta"].forEach(addRow);
		mount(createElement(SelectionMenu));
		act(() => {
			useOutlineStore.getState().restoreItemSelection(["Bravo"]);
		});
		expect({
			count: document.querySelectorAll(".selection-menu").length,
			className: menu()?.className,
			rows: rowLabels(),
			footer: menu()?.querySelector(".text-center")?.textContent,
			placement: menu()?.dataset.popperPlacement,
		}).toStrictEqual({
			count: 1,
			className: expect.stringMatching(
				/^\n {12}\[\.moving_&\]:hidden\n {12}wf-menu flex flex-col[\s\S]*print:hidden\n {12}flyout menu selection-menu\n {10}$/u,
			),
			rows: LOCAL_ORDER,
			footer: "1 items",
			placement: "right-start",
		});
	});

	it("counts every selected entry and anchors on the last inserted one", () => {
		["Alpha", "Bravo", "Charlie", "Delta"].forEach(addRow);
		const anchors: Element[] = [];
		const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
			anchors.push(this);
			return new DOMRect(0, 0, 100, 20);
		});
		mount(createElement(SelectionMenu));
		act(() => {
			useOutlineStore.getState().restoreItemSelection(["Delta", "Alpha"]);
		});
		spy.mockRestore();
		const alpha = document.querySelector('[data-node-id="Alpha"]')?.closest(".project");
		expect({
			footer: menu()?.querySelector(".text-center")?.textContent,
			anchored: anchors.includes(alpha!),
		}).toStrictEqual({
			footer: "2 items",
			anchored: true,
		});
	});

	it("removes the menu synchronously when the selection clears", () => {
		addRow("Bravo");
		mount(createElement(SelectionMenu));
		act(() => {
			useOutlineStore.getState().restoreItemSelection(["Bravo"]);
		});
		const before = menu() !== null;
		act(() => {
			useOutlineStore.getState().clearItemSelection();
		});
		expect([before, menu()]).toStrictEqual([true, null]);
	});

	it("runs a clicked row on the selection, keeps the selection, and ignores a meta-click", () => {
		addRow("Bravo");
		mount(createElement(SelectionMenu));
		act(() => {
			useOutlineStore.getState().restoreItemSelection(["Bravo"]);
		});
		const row = document.querySelector<HTMLElement>('.selection-menu [data-handbook="toggle_h1"]');
		act(() => {
			row?.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, metaKey: true}));
		});
		const afterMeta = executed.length;
		act(() => {
			row?.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}));
		});
		expect({
			afterMeta,
			executed: executed.map((run) => [run.id, run.ctx.items]),
			selection: useOutlineStore.getState().itemSelection.entries.map((entry) => entry.id),
			stillOpen: menu() !== null,
		}).toStrictEqual({
			afterMeta: 0,
			executed: [["toggle_h1", ["Bravo"]]],
			selection: ["Bravo"],
			stillOpen: true,
		});
	});

	it("has no keyboard model: arrows and Enter add no .active row and run nothing", () => {
		addRow("Bravo");
		mount(createElement(SelectionMenu));
		act(() => {
			useOutlineStore.getState().restoreItemSelection(["Bravo"]);
		});
		act(() => {
			for (const key of ["ArrowDown", "Enter"]) {
				globalThis.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true}));
			}
		});
		expect([document.querySelectorAll(".selection-menu .active").length, executed.length]).toStrictEqual([0, 0]);
	});

	it("renders nothing when the selected row is not rendered", () => {
		mount(createElement(SelectionMenu));
		act(() => {
			useOutlineStore.getState().setItemSelection(selectionOf(["Bravo"]));
		});
		expect(menu()).toBeNull();
	});
});

describe("SelectionMenuView", () => {
	it("omits the footer separator when every item is read-only", () => {
		addRow("Bravo");
		const anchor = document.body.querySelector<HTMLElement>(".project");
		if (anchor === null) {
			throw new Error("no anchor row");
		}
		mount(
			createElement(SelectionMenuView, {
				anchor,
				entries: [
					{kind: "command", id: "delete", label: "Delete", icon: "fal:trash-can", shortcutCommand: null},
				],
				count: 1,
				readOnly: true,
				onSelect: () => {},
			}),
		);
		expect([...(menu()?.querySelector(".scroller")?.children ?? [])].map((child) => child.tagName)).toStrictEqual([
			"A",
			"DIV",
		]);
	});
});
