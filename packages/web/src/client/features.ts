/**
 * Account feature flags (upstream `WF.Features`). Once `useFeatures` has loaded the account's enabled
 * dict, that dict answers every `isFeatureOn`. Until then (first paint, or no account data at all) a
 * `localStorage["wf.features.<name>"] === "on"` override applies, then `DEFAULT_FEATURES`.
 */

/** The 20 visible codenames plus the hidden ones the client reads. */
export type FeatureName =
	| "beta_redirect"
	| "open_links_in_desktop"
	| "dates"
	| "full_width_page"
	| "templates"
	| "bdl"
	| "keep_keyboard_on_scroll"
	| "rich_tags"
	| "always_visible_controls"
	| "update_notifications"
	| "conversations"
	| "dashboards"
	| "ai"
	| "present"
	| "nested_search"
	| "markdown_pasting"
	| "calendar_node"
	| "numbered_list"
	| "table"
	| "side_pane"
	| "check"
	| "slash-command"
	| "trash";

/** The enabled dict of the account the clone tracks (measured 2026-10-26): dashboards, conversations and ai are off. */
export const DEFAULT_FEATURES: Readonly<Record<string, true>> = {
	always_visible_controls: true,
	bdl: true,
	beta_redirect: true,
	calendar_node: true,
	check: true,
	dates: true,
	full_width_page: true,
	keep_keyboard_on_scroll: true,
	markdown_pasting: true,
	nested_search: true,
	numbered_list: true,
	open_links_in_desktop: true,
	present: true,
	rich_tags: true,
	side_pane: true,
	"slash-command": true,
	table: true,
	templates: true,
	trash: true,
	update_notifications: true,
};

let accountFeatures: Readonly<Record<string, true>> | null = null;

/** Store the account's enabled dict (null forgets it); `useFeatures` calls this on every successful read. */
export function setAccountFeatures(features: Readonly<Record<string, true>> | null): void {
	accountFeatures = features;
}

/** Whether the account's enabled dict has been loaded (so a once-per-load reader can cache its answer). */
export function accountFeaturesKnown(): boolean {
	return accountFeatures !== null;
}

interface FeatureStorage {
	getItem(key: string): string | null;
}

function browserStorage(): FeatureStorage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

export function isFeatureOn(name: FeatureName, storage: FeatureStorage | null = browserStorage()): boolean {
	if (accountFeatures !== null) {
		return accountFeatures[name] === true;
	}
	try {
		if (storage?.getItem(`wf.features.${name}`) === "on") {
			return true;
		}
	} catch {
		// Blocked storage falls through to the defaults.
	}
	return DEFAULT_FEATURES[name] === true;
}
