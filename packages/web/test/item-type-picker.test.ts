import {describe, expect, it, vi} from "vite-plus/test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {createElement} from "react";
import type {ReactNode, ReactPortal} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {ITEM_TYPES} from "../src/client/layout-types.js";
import type {ItemType} from "../src/client/layout-types.js";

vi.mock(import("react-dom"), async (importOriginal) => ({
	...(await importOriginal()),
	createPortal: (node: ReactNode): ReactPortal => node as ReactPortal,
}));

const blur = vi.fn<() => void>();
class FakeElement {
	blur = blur;
}
vi.stubGlobal("HTMLElement", FakeElement);
vi.stubGlobal("document", {activeElement: new FakeElement(), body: {classList: {add: () => {}, remove: () => {}}}});

const {ItemTypePicker, itemTypePickerItems} = await import("../src/client/components/layout-menu.js");

const dump = readFileSync(
	fileURLToPath(new URL("../../../.llm/upstream-sync/dumps/layout-modes-upstream-dom.html", import.meta.url)),
	"utf8",
);

function tokens(className: string): string[] {
	return className.split(/\s+/u).filter(Boolean);
}

/** Collapses each class attribute to single-spaced tokens and drops svg path data (stripped in the dump). */
function normalize(markup: string): string {
	return markup
		.replaceAll(/class="([^"]*)"/gu, (_match, className: string) => `class="${tokens(className).join(" ")}"`)
		.replaceAll(/ d="[^"]*"/gu, "");
}

function renderItems(): string[] {
	return itemTypePickerItems(ITEM_TYPES, () => {}).map((item) => renderToStaticMarkup(item));
}

function anchorAttribute(markup: string, name: string): string | undefined {
	const open = /^<a[^>]*>/u.exec(markup)?.[0] ?? "";
	return new RegExp(` ${name}="([^"]*)"`, "u").exec(open)?.[1];
}

const UPSTREAM_ROW_CLASS =
	"pl-l py-xs pr-l block !no-underline cursor-pointer whitespace-nowrap leading-base border-solid border-primary text-primary hover:bg-secondary mobile:border-t mobile:last:border-b mobile:py-ml mobile:landscape:pl-safe-left mobile:landscape:pr-safe-right menuItem";

describe("ItemTypePicker items", () => {
	it("renders the twelve upstream rows with item-type class tokens, handbooks and labels in order", () => {
		const rows = renderItems();
		expect(
			rows.map((row) => ({
				classes: tokens(anchorAttribute(row, "class") ?? ""),
				handbook: anchorAttribute(row, "data-handbook") ?? "-",
				placement: anchorAttribute(row, "data-handbook-placement"),
				label: /<\/div>([^<]*)<\/span>/u.exec(row)?.[1],
			})),
		).toStrictEqual(
			[
				["bullets", "toggle_bullet", "Bullets"],
				["h1", "toggle_h1", "Heading 1"],
				["h2", "toggle_h2", "Heading 2"],
				["h3", "toggle_h3", "Heading 3"],
				["p", "toggle_paragraph", "Paragraph"],
				["todo", "toggle_todo", "To-do"],
				["numbered", "-", "Number"],
				["board", "toggle_board", "Board"],
				["table", "-", "Table"],
				["quote-block", "-", "Quote"],
				["code-block", "-", "Code Block"],
				["divider", "-", "Divider"],
			].map(([key, handbook, label]) => ({
				classes: [...tokens(UPSTREAM_ROW_CLASS), `${key}-item-type`, "canHover"],
				handbook,
				placement: "right",
				label,
			})),
		);
	});

	it("renders the Bullets row exactly as the upstream dump", () => {
		const upstream = dump.split("\n").find((line) => line.includes('data-handbook="toggle_bullet"'));
		expect(normalize(renderItems()[0] ?? "")).toBe(normalize(upstream?.trim() ?? ""));
	});

	it("passes the chosen type to onSelect and blurs the focused picker so it closes", () => {
		const onSelect = vi.fn<(type: ItemType) => void>();
		itemTypePickerItems(ITEM_TYPES, onSelect)[7]?.props.onSelect?.();
		expect({selected: onSelect.mock.calls, blurs: blur.mock.calls.length}).toStrictEqual({
			selected: [[ITEM_TYPES[7]]],
			blurs: 1,
		});
	});
});

describe("ItemTypePicker host", () => {
	it("renders an absolutely positioned host around a ButtonMenu with no button", () => {
		expect(
			renderToStaticMarkup(
				createElement(ItemTypePicker, {
					position: {top: 46, left: 1131},
					types: ITEM_TYPES,
					onSelect: () => {},
					onClose: () => {},
				}),
			),
		).toBe(
			`<div style="position:absolute;top:46px;left:1131px"><div tabindex="0" class="relative outline-none menu "><div></div></div></div>`,
		);
	});
});
