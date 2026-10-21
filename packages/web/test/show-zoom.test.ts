import {describe, expect, it} from "vite-plus/test";
import {showZoom} from "../src/client/show-zoom.js";

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
