import {parseLocationHash, shortId} from "./location.js";

/** A navigable location; `id` is a short id (or null for home) so full and short URLs compare equal. */
export interface Loc {
	id: string | null;
	query: string | null;
}

/** Upstream's in-app Back/Forward stacks, independent of browser history. */
export interface NavState {
	current: Loc | null;
	back: Loc[];
	forward: Loc[];
}

export type NavAction =
	| {type: "navigate"; loc: Loc}
	| {type: "back"}
	| {type: "forward"}
	| {type: "popstate"; loc: Loc};

export const BACK_STACK_CAP = 100;

export const initialNavState: NavState = {current: null, back: [], forward: []};

function locEquals(a: Loc | null, b: Loc | null): boolean {
	return a !== null && b !== null && a.id === b.id && a.query === b.query;
}

export function locFromHash(hash: string): Loc {
	const {id, query} = parseLocationHash(hash);
	return {id: id === null ? null : shortId(id), query};
}

function pushCapped(stack: Loc[], loc: Loc | null): Loc[] {
	return loc === null ? stack : [...stack, loc].slice(-BACK_STACK_CAP);
}

/**
 * `navigate` pushes the current location onto `back` and clears `forward` (no-op
 * when already there); `back`/`forward` move one step between the stacks;
 * `popstate` (browser Back/Forward) sets the current location only.
 */
export function navReducer(state: NavState, action: NavAction): NavState {
	switch (action.type) {
		case "navigate": {
			if (locEquals(state.current, action.loc)) {
				return state;
			}
			return {current: action.loc, back: pushCapped(state.back, state.current), forward: []};
		}
		case "back": {
			const target = state.back.at(-1);
			if (target === undefined) {
				return state;
			}
			return {current: target, back: state.back.slice(0, -1), forward: pushCapped(state.forward, state.current)};
		}
		case "forward": {
			const target = state.forward.at(-1);
			if (target === undefined) {
				return state;
			}
			return {current: target, back: pushCapped(state.back, state.current), forward: state.forward.slice(0, -1)};
		}
		case "popstate": {
			break;
		}
	}
	return {...state, current: action.loc};
}
