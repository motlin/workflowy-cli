// Upstream's location-picker row list (results list `KM` + the bottomSticky create footer).
// An empty query lists recent then starred locations above two disabled create rows; a query
// lists up to `limit` results (with `More results` when cut, or a help row when empty) above
// two enabled create rows. The keyboard model lives in the shared menu reducer, which skips
// `disabled` rows.

export type PickerRowKind = "result" | "recent" | "starred" | "more" | "create-default" | "create-elsewhere" | "help";

export type PickerIcon = "clock" | "star" | "ellipsis" | "plus" | "arrow-up" | null;

export interface PickerRow {
	kind: PickerRowKind;
	id?: string;
	labelHtml: string;
	disabled: boolean;
	icon: PickerIcon;
}

export interface PickerResult {
	id: string;
	labelHtml: string;
}

export interface PickerRowsInput {
	query: string;
	results: readonly PickerResult[];
	/** Recent location ids, newest first. */
	recentIds: readonly string[];
	/** Starred page ids in `mostRecent` order (Home and searches already excluded). */
	starredIds: readonly string[];
	forItemId: string;
	expanded: boolean;
	/** Name HTML of the newest recent location, or the default `Notes` location. */
	recentLabel: string;
	/** Name HTML of a recent or starred location. */
	labelOf: (id: string) => string;
	/** `false` for a searcher without an action (`Select child...`): no create rows. */
	action?: boolean;
	limit?: number;
}

function escapeHtml(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function locationRows(input: PickerRowsInput): PickerRow[] {
	const listed = new Set([input.forItemId]);
	const rows: PickerRow[] = [];
	for (const [ids, kind, icon] of [
		[input.recentIds, "recent", "clock"],
		[input.starredIds, "starred", "star"],
	] as const) {
		for (const id of ids) {
			if (listed.has(id)) {
				continue;
			}
			listed.add(id);
			rows.push({kind, id, labelHtml: input.labelOf(id), disabled: false, icon});
		}
	}
	return rows;
}

function resultRows(input: PickerRowsInput): PickerRow[] {
	const matches = input.results.filter((result) => result.id !== input.forItemId);
	if (matches.length === 0) {
		return [{kind: "help", labelHtml: "No matching locations found", disabled: true, icon: null}];
	}
	const limit = input.limit ?? 5;
	const cut = !input.expanded && matches.length > limit;
	const shown = cut ? matches.slice(0, limit) : matches;
	const rows: PickerRow[] = shown.map((result) => ({
		kind: "result",
		id: result.id,
		labelHtml: result.labelHtml,
		disabled: false,
		icon: null,
	}));
	if (cut) {
		rows.push({kind: "more", labelHtml: "More results", disabled: false, icon: "ellipsis"});
	}
	return rows;
}

export function buildPickerRows(input: PickerRowsInput): PickerRow[] {
	const rows = input.query === "" ? locationRows(input) : resultRows(input);
	if (input.action === false) {
		return rows;
	}
	const q = escapeHtml(input.query);
	const disabled = input.query === "";
	return [
		...rows,
		{kind: "create-default", labelHtml: `New "${q}" in: <b>${input.recentLabel}</b>`, disabled, icon: "plus"},
		{kind: "create-elsewhere", labelHtml: `New "${q}" in…`, disabled, icon: "arrow-up"},
	];
}

/** The row active on open and after every filter change (`initialSelect` 0 over enabled rows). */
export function firstEnabledIndex(rows: readonly PickerRow[]): number {
	return rows.findIndex((row) => !row.disabled);
}
