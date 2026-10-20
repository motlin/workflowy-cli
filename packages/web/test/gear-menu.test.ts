import {describe, expect, it, vi} from "vite-plus/test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";

vi.mock("../src/client/stores/outline.js", () => ({
	useOutlineStore: (
		selector: (state: {openExportDialog: () => void; mutationCount: number; lastSavedAt: number}) => unknown,
	) => selector({openExportDialog: () => {}, mutationCount: 0, lastSavedAt: 0}),
	selectIsMutating: (state: {mutationCount: number}) => state.mutationCount > 0,
}));

const {GearMenu} = await import("../src/client/components/gear-menu.js");

function render(headerItems: {label: string; icon: string; onSelect: () => void; disabled?: boolean}[]): string {
	return renderToStaticMarkup(
		createElement(GearMenu, {
			isOpen: true,
			onClose: () => {},
			onOpenSettings: () => {},
			onExpandAll: () => {},
			onCollapseAll: () => {},
			onUndo: () => {},
			onRedo: () => {},
			headerItems,
		}),
	);
}

function labels(html: string): string[] {
	return [...html.matchAll(/gear-menu-item-label">([^<]*)<|class="(gear-menu-divider)"/gu)].map((match) =>
		match[0].startsWith("class") ? "------------" : match[1],
	);
}

describe("GearMenu header items", () => {
	it("prepends header items and a separator before What's New", () => {
		const html = render([
			{label: "Share", icon: "S", onSelect: () => {}},
			{label: "Present", icon: "P", onSelect: () => {}, disabled: true},
		]);
		expect(labels(html).slice(0, 4)).toStrictEqual(["Share", "Present", "------------", "What&#x27;s New"]);
		expect(html).toContain('<button class="gear-menu-item disabled" disabled="" type="button">');
	});

	it("renders no leading separator without header items", () => {
		expect(labels(render([]))[0]).toBe("What&#x27;s New");
	});
});
