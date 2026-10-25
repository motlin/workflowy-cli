import {describe, expect, it, vi} from "vite-plus/test";

vi.mock("../src/client/stores/outline.js", () => ({
	useOutlineStore: (selector: (state: {openExportDialog: () => void; lastSavedAt: number}) => unknown) =>
		selector({openExportDialog: () => {}, lastSavedAt: 0}),
}));
vi.mock("../src/client/hooks/use-saving.js", () => ({useSaving: () => false}));

const {useMainMenuRows} = await import("../src/client/components/main-menu-rows.js");
const {renderMainMenuRows} = await import("./helpers/render-main-menu-rows.js");

interface Item {
	label: string;
	icon: string;
	onSelect: () => void;
	disabled?: boolean;
}

function render(headerItems: Item[], paneItems: Item[] = []): string {
	return renderMainMenuRows(useMainMenuRows, headerItems, paneItems);
}

function labels(html: string): string[] {
	return [
		...html.matchAll(
			/desktop:text-xs">(?:<div class="menuItemIcon[^>]*>.*?<\/div>)?([^<]*)<|class="(border-t border-primary border-solid my-s)"/gu,
		),
	].map((match) => (match[0].startsWith("class") ? "------------" : match[1]));
}

describe("GearMenu header items", () => {
	it("prepends header items and a separator before Undo", () => {
		const html = render([
			{label: "Share", icon: "S", onSelect: () => {}},
			{label: "Present", icon: "P", onSelect: () => {}, disabled: true},
		]);
		expect(labels(html).slice(0, 4)).toStrictEqual(["Share", "Present", "------------", "Undo"]);
		const disabled = html
			.split("<a ")
			.filter((row) => row.includes("\n        text-tertiary\n"))
			.map((row) => /desktop:text-xs">(?:<div class="menuItemIcon[^>]*>.*?<\/div>)?([^<]*)</u.exec(row)?.[1]);
		expect(disabled).toStrictEqual(["Present", "Undo", "Redo"]);
	});

	it("follows the header items with upstream's Move pane left/right rows and a separator", () => {
		const html = render(
			[{label: "Share", icon: "S", onSelect: () => {}}],
			[
				{label: "Move pane left", icon: "L", onSelect: () => {}, disabled: true},
				{label: "Move pane right", icon: "R", onSelect: () => {}},
			],
		);
		expect(labels(html).slice(0, 6)).toStrictEqual([
			"Share",
			"------------",
			"Move pane left",
			"Move pane right",
			"------------",
			"Undo",
		]);
	});

	it("renders no leading separator without header items", () => {
		expect(labels(render([]))[0]).toBe("Undo");
	});

	it("renders Undo and Help with upstream's handbook keys, icons and chevron", () => {
		const html = render([]);
		const undo = html.split("<a ").find((row) => row.includes('data-handbook="undo.undo"')) ?? "";
		const help = html.split("<a ").find((row) => row.includes("Help<")) ?? "";
		expect({
			undoIcon: undo.includes('data-icon="arrow-rotate-left"'),
			undoShortcut: undo.includes(">⌘Z</span>"),
			helpIcon: help.includes('data-icon="circle-question"'),
			helpChevron:
				help.includes('<span style="margin-left:6px"><svg') && help.includes('data-icon="chevron-down"'),
			legacyClass: html.includes("gear-menu"),
		}).toStrictEqual({
			undoIcon: true,
			undoShortcut: true,
			helpIcon: true,
			helpChevron: true,
			legacyClass: false,
		});
	});

	it("lays out upstream's rows, hiding those with no local meaning (What's New, Zapier, Log out, desktop rows)", () => {
		expect(labels(render([]))).toStrictEqual([
			"Undo",
			"Redo",
			"------------",
			"Expand all",
			"Collapse all",
			"------------",
			"Export",
			"Print",
			"------------",
			"Settings",
			"------------",
			"Get the Apps",
			"------------",
			"Help",
			"------------",
		]);
	});
});
