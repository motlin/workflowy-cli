/**
 * Local stand-in for upstream's Labs feature flags (`WF.Features`). Every flag defaults to off, like the
 * account the clone tracks; `localStorage["wf.features.<name>"] === "on"` turns one on in this browser.
 */
export type FeatureName = "dashboards";

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
	try {
		return storage?.getItem(`wf.features.${name}`) === "on";
	} catch {
		return false;
	}
}
