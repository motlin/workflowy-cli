import {describe, expect, it} from "vite-plus/test";
import {outlineRootToShow, showZoom} from "../src/client/show-zoom.js";

function run(inSidePane: boolean, scrollTop: boolean): string[] {
	const calls: string[] = [];
	showZoom("alice", scrollTop, {
		inSidePane,
		zoomSidePane: (id) => {
			calls.push(`pane:${id}`);
		},
		goToNode: (id) => {
			calls.push(`url:${id}`);
		},
		scrollToTop: (pane) => {
			calls.push(`scroll:${pane}`);
		},
	});
	return calls;
}

describe("showZoom", () => {
	it("navigates the main outline and scrolls the page while the main pane is active", () => {
		expect(run(false, true)).toStrictEqual(["url:alice", "scroll:main"]);
	});

	it("zooms the side pane and scrolls its scroller while it is active, leaving the URL alone", () => {
		expect(run(true, true)).toStrictEqual(["pane:alice", "scroll:side"]);
	});

	it("keeps the scroll position when the zoom does not scroll to the top", () => {
		expect(run(true, false)).toStrictEqual(["pane:alice"]);
	});
});

describe("outlineRootToShow", () => {
	it("shows the requested root once its children are loaded", () => {
		expect(outlineRootToShow("bob", false, "alice")).toBe("bob");
	});

	it("keeps the previous root on screen while the requested root's children load", () => {
		expect(outlineRootToShow("bob", true, "alice")).toBe("alice");
	});

	it("keeps Home on screen while a zoom away from it loads", () => {
		expect(outlineRootToShow("bob", true, null)).toBeNull();
	});

	it("shows the requested root (and its loading state) when nothing was shown yet", () => {
		expect(outlineRootToShow("bob", true, undefined)).toBe("bob");
	});
});
