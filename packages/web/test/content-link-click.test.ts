import {describe, expect, it} from "vite-plus/test";
import {contentLinkAction, internalLinkId} from "../src/client/content-link-click.js";

const ORIGIN = "http://localhost:5175";
const none = {metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, button: 0};

describe("internalLinkId", () => {
	it("reads the item id from upstream's internal link and from this app's own links", () => {
		expect([
			internalLinkId("https://workflowy.com/#/0123456789ab", ORIGIN),
			internalLinkId("https://beta.workflowy.com/#/0123456789ab?q=%23tag", ORIGIN),
			internalLinkId("http://localhost:5175/#/0123456789ab", ORIGIN),
			internalLinkId("/#/0123456789ab", ORIGIN),
		]).toStrictEqual(["0123456789ab", "0123456789ab", "0123456789ab", "0123456789ab"]);
	});

	it("ignores external links, links to Home, and unparsable hrefs", () => {
		expect([
			internalLinkId("https://example.com/#/0123456789ab", ORIGIN),
			internalLinkId("https://workflowy.com/", ORIGIN),
			internalLinkId("mailto:alice@example.com", ORIGIN),
			internalLinkId("http://[bad", ORIGIN),
		]).toStrictEqual([null, null, null, null]);
	});
});

describe("contentLinkAction", () => {
	it("⌘-click on mac and ⌃-click elsewhere open the link in a pane, from either pane", () => {
		expect([
			contentLinkAction({...none, metaKey: true}, true, false),
			contentLinkAction({...none, metaKey: true}, true, true),
			contentLinkAction({...none, ctrlKey: true}, false, false),
		]).toStrictEqual(["open_in_pane", "open_in_pane", "open_in_pane"]);
	});

	it("⌥-click opens the link in a pane on every platform, like upstream", () => {
		expect([
			contentLinkAction({...none, altKey: true}, true, false),
			contentLinkAction({...none, altKey: true}, false, false),
		]).toStrictEqual(["open_in_pane", "open_in_pane"]);
	});

	it("a plain click navigates the side pane and leaves the main pane's click alone", () => {
		expect([contentLinkAction(none, true, true), contentLinkAction(none, true, false)]).toStrictEqual([
			"navigate_pane",
			null,
		]);
	});

	it("leaves other modifier combos and non-left buttons to the browser", () => {
		expect([
			contentLinkAction({...none, ctrlKey: true}, true, true),
			contentLinkAction({...none, metaKey: true}, false, true),
			contentLinkAction({...none, metaKey: true, shiftKey: true}, true, false),
			contentLinkAction({...none, metaKey: true, altKey: true}, true, false),
			contentLinkAction({...none, button: 1}, true, true),
		]).toStrictEqual([null, null, null, null, null]);
	});
});
