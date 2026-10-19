export interface SwitcherSelectionState {
	selected: number;
	filter: string;
	count: number;
}

export interface SwitcherSelection {
	getState: () => SwitcherSelectionState;
	/** Sets the filter and moves the selection back to the first row. */
	search: (filter: string) => void;
	hover: (index: number) => void;
	/** Moves down one row, wrapping from the last row to the first. */
	selectNext: () => void;
	/** Moves up one row, wrapping from the first row to the last. */
	selectPrev: () => void;
	setCount: (count: number) => void;
	reset: () => void;
}

const EMPTY: SwitcherSelectionState = {selected: 0, filter: "", count: 0};

/** Upstream's jump-menu selection: the highlighted row wraps at both ends instead of clamping. */
export function createSwitcherSelection(): SwitcherSelection {
	let state = EMPTY;

	return {
		getState: () => state,
		search: (filter) => {
			state = {...state, filter, selected: 0};
		},
		hover: (index) => {
			state = {...state, selected: index};
		},
		selectNext: () => {
			const {selected, count} = state;
			state = {...state, selected: count === 0 ? 0 : (selected + 1) % count};
		},
		selectPrev: () => {
			const {selected, count} = state;
			state = {...state, selected: count === 0 ? 0 : selected <= 0 ? count - 1 : selected - 1};
		},
		setCount: (count) => {
			state = {...state, count};
		},
		reset: () => {
			state = EMPTY;
		},
	};
}
