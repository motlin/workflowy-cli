import {create} from "zustand";

/** App-level navigation stack; independent of `history.length`, which includes pages outside the app. */
export interface NavState {
	stack: string[];
	index: number;
}

export type NavAction = {type: "push"; path: string} | {type: "pop"; path: string; idx?: number};

export const initialNavState: NavState = {stack: [], index: -1};

/** Index of the stack entry equal to `path` that is nearest to `from`, or -1. */
function nearestIndex(stack: string[], path: string, from: number): number {
	let best = -1;
	for (const [i, entry] of stack.entries()) {
		if (entry === path && (best === -1 || Math.abs(i - from) < Math.abs(best - from))) {
			best = i;
		}
	}
	return best;
}

/**
 * `push` (link click, programmatic navigate) truncates forward entries and appends.
 * `pop` (browser back/forward) moves to the matching entry, preferring React Router's
 * `history.state.idx` when it names the same path and falling back to it when the path is unknown.
 */
export function navReducer(state: NavState, action: NavAction): NavState {
	if (action.type === "push") {
		return {stack: [...state.stack.slice(0, state.index + 1), action.path], index: state.index + 1};
	}
	const {idx} = action;
	const idxInRange = idx !== undefined && idx >= 0 && idx < state.stack.length;
	if (idxInRange && state.stack[idx] === action.path) {
		return {...state, index: idx};
	}
	const match = nearestIndex(state.stack, action.path, state.index);
	if (match !== -1) {
		return {...state, index: match};
	}
	return idxInRange ? {...state, index: idx} : state;
}

export function derive(state: NavState): {canGoBack: boolean; canGoForward: boolean} {
	return {canGoBack: state.index > 0, canGoForward: state.index < state.stack.length - 1};
}

export const useNavHistoryStore = create<NavState & {dispatch: (action: NavAction) => void}>((set) => ({
	...initialNavState,
	dispatch: (action) => {
		set((state) => navReducer(state, action));
	},
}));

interface HistoryLike {
	back: () => void;
	forward: () => void;
}

/** Step browser history only when the app-level stack allows it; upstream ignores Back/Forward at either end. */
export function historyStep(direction: -1 | 1, history: HistoryLike = globalThis.history): void {
	const {canGoBack, canGoForward} = derive(useNavHistoryStore.getState());
	if (direction === -1 && canGoBack) {
		history.back();
	} else if (direction === 1 && canGoForward) {
		history.forward();
	}
}
