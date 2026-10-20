import {describe, expect, it, vi} from "vite-plus/test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";

vi.mock(import("react"), async (importOriginal) => ({
	...(await importOriginal()),
	useEffect: (effect: () => void) => {
		effect();
	},
}));
vi.mock("../src/client/stores/outline.js", () => ({
	useOutlineStore: (
		selector: (state: {openExportDialog: () => void; mutationCount: number; lastSavedAt: number}) => unknown,
	) => selector({openExportDialog: () => {}, mutationCount: 0, lastSavedAt: 0}),
	selectIsMutating: (state: {mutationCount: number}) => state.mutationCount > 0,
}));
const keydowns = vi.hoisted(() => [] as ((event: {key: string; preventDefault: () => void}) => void)[]);
vi.stubGlobal("document", {
	addEventListener: (type: string, listener: (event: {key: string; preventDefault: () => void}) => void) => {
		if (type === "keydown") {
			keydowns.push(listener);
		}
	},
	removeEventListener: () => {},
});

const {GearMenu} = await import("../src/client/components/gear-menu.js");

describe("GearMenu Escape", () => {
	it("closes and claims Escape so it does not also focus search", () => {
		const onClose = vi.fn<() => void>();
		renderToStaticMarkup(
			createElement(GearMenu, {
				isOpen: true,
				onClose,
				onOpenSettings: () => {},
				onExpandAll: () => {},
				onCollapseAll: () => {},
				onUndo: () => {},
				onRedo: () => {},
			}),
		);
		const preventDefault = vi.fn<() => void>();
		for (const listener of keydowns) {
			listener({key: "Escape", preventDefault});
		}
		expect({closed: onClose.mock.calls.length, prevented: preventDefault.mock.calls.length}).toStrictEqual({
			closed: 1,
			prevented: 1,
		});
	});
});
