/**
 * Upstream's capture-phase click handler for `a.contentLink` (`cx4`): an internal link opens in a pane on ⌘-click (mac;
 * ⌃-click elsewhere) or ⌥-click, and a plain click inside a side pane navigates that pane.
 */
import {parseLocationHash} from "./location.js";

const WORKFLOWY_HOSTS: ReadonlySet<string> = new Set(["workflowy.com", "dev.workflowy.com", "beta.workflowy.com"]);

/** The item id an internal link names (`workflowy.com/#/<id>` or this app's own `/#/<id>`); null for anything else. */
export function internalLinkId(href: string, origin: string): string | null {
	let url: URL;
	try {
		url = new URL(href, origin);
	} catch {
		return null;
	}
	const internal = url.origin === origin || (/^https?:$/u.test(url.protocol) && WORKFLOWY_HOSTS.has(url.hostname));
	return internal ? parseLocationHash(url.hash).id : null;
}

export type ContentLinkAction = "open_in_pane" | "navigate_pane";

interface LinkClick {
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	button: number;
}

/**
 * What a click on an internal link does. ⌥ alone, or the platform's primary modifier alone, opens it in a pane; a plain
 * click navigates the side pane it sits in. Anything else (and a plain click in the main pane) is left alone.
 */
export function contentLinkAction(event: LinkClick, isMac: boolean, inSidePane: boolean): ContentLinkAction | null {
	if (event.button !== 0) {
		return null;
	}
	const alt = event.altKey && !event.ctrlKey && !event.metaKey;
	const primary = isMac
		? event.metaKey && !event.altKey && !event.ctrlKey
		: event.ctrlKey && !event.altKey && !event.metaKey;
	if (!event.shiftKey && (alt || primary)) {
		return "open_in_pane";
	}
	const modified = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
	return !modified && inSidePane ? "navigate_pane" : null;
}
