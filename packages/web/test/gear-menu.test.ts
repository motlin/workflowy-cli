import {describe, expect, it, vi} from "vite-plus/test";

vi.mock("../src/client/stores/outline.js", () => ({
	useOutlineStore: (selector: (state: {openExportDialog: () => void; lastSavedAt: number}) => unknown) =>
		selector({openExportDialog: () => {}, lastSavedAt: 0}),
}));
vi.mock("../src/client/hooks/use-saving.js", () => ({useSaving: () => false}));

const {useGearMenuRows} = await import("../src/client/components/gear-menu.js");
const {renderGearMenuRows} = await import("./helpers/render-gear-menu-rows.js");

interface Item {
	label: string;
	icon: string;
	onSelect: () => void;
	disabled?: boolean;
}

function render(headerItems: Item[], paneItems: Item[] = []): string {
	return renderGearMenuRows(useGearMenuRows, headerItems, paneItems);
}

function labels(html: string): string[] {
	return [
		...html.matchAll(
			/desktop:text-xs">(?:<div class="menuItemIcon[^>]*>.*?<\/div>)?([^<]*)<|class="(border-t border-primary border-solid my-s)"/gu,
		),
	].map((match) => (match[0].startsWith("class") ? "------------" : match[1]));
}

describe("GearMenu header items", () => {
	it("prepends header items and a separator before Learn WorkFlowy", () => {
		const html = render([
			{label: "Share", icon: "S", onSelect: () => {}},
			{label: "Present", icon: "P", onSelect: () => {}, disabled: true},
		]);
		expect(labels(html).slice(0, 4)).toStrictEqual(["Share", "Present", "------------", "Learn WorkFlowy"]);
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
			"Learn WorkFlowy",
		]);
	});

	it("renders no leading separator without header items", () => {
		expect(labels(render([]))[0]).toBe("Learn WorkFlowy");
	});

	it("hides the rows that have no local backend (What's New, Connect Apps with Zapier)", () => {
		expect(labels(render([])).slice(0, 4)).toStrictEqual(["Learn WorkFlowy", "------------", "Undo", "Redo"]);
	});
});
