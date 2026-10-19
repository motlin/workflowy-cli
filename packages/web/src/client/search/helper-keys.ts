/** The search helper flyout's highlighted tab and chip; -1 means none. */
export interface HelperSelection {
	tab: number;
	chip: number;
}

export interface HelperLayout {
	tabCount: number;
	/** The visual row of each chip in the selected tab's panel (empty when the panel has no chips). */
	chipRows: readonly number[];
}

export const NO_HELPER_SELECTION: HelperSelection = {tab: -1, chip: -1};

/** The keys the flyout consumes from `#srch-input`; Ctrl+P / Ctrl+N arrive here as ArrowLeft / ArrowRight. */
export const HELPER_NAV_KEYS: ReadonlySet<string> = new Set(["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"]);

function chipInRow(chipRows: readonly number[], row: number, column: number): number {
	const start = chipRows.indexOf(row);
	const end = chipRows.lastIndexOf(row);
	return Math.min(start + column, end);
}

function chipKey(selection: HelperSelection, key: string, chipRows: readonly number[]): HelperSelection {
	const {chip} = selection;
	const row = chipRows[chip] ?? 0;
	const column = chip - chipRows.indexOf(row);
	switch (key) {
		case "ArrowLeft":
			return {...selection, chip: Math.max(0, chip - 1)};
		case "ArrowRight":
			return {...selection, chip: Math.min(chipRows.length - 1, chip + 1)};
		case "ArrowUp":
			return {...selection, chip: row === chipRows[0] ? -1 : chipInRow(chipRows, row - 1, column)};
		case "ArrowDown":
			return chipRows.includes(row + 1) ? {...selection, chip: chipInRow(chipRows, row + 1, column)} : selection;
		default:
			return selection;
	}
}

function tabKey(selection: HelperSelection, key: string, layout: HelperLayout): HelperSelection {
	const {tab} = selection;
	switch (key) {
		case "ArrowDown":
			if (tab === -1) {
				return {tab: 0, chip: -1};
			}
			return layout.chipRows.length > 0 ? {tab, chip: 0} : selection;
		case "ArrowUp":
			return {tab: -1, chip: -1};
		case "ArrowLeft":
			return tab === -1 ? selection : {tab: Math.max(0, tab - 1), chip: -1};
		case "ArrowRight":
			return tab === -1 ? selection : {tab: Math.min(layout.tabCount - 1, tab + 1), chip: -1};
		default:
			return selection;
	}
}

/**
 * Upstream's helper flyout keyboard model: Down from nothing picks the first tab, Left/Right move the tab (clamped),
 * Down enters the chips, chips move Left/Right and by visual row Up/Down, Up from the first chip row returns to the
 * tab row, and Up on the tab row clears the selection.
 */
export function helperKeyReducer(selection: HelperSelection, key: string, layout: HelperLayout): HelperSelection {
	return selection.chip === -1 ? tabKey(selection, key, layout) : chipKey(selection, key, layout.chipRows);
}
