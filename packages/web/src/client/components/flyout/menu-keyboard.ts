export interface MenuKeyboardState {
	index: number;
	hidden: boolean;
	keyboardMode: boolean;
}

export interface MenuKeyboardEvent {
	key: string;
	ctrlKey: boolean;
	shiftKey: boolean;
	composing: boolean;
}

export interface MenuKeyboardOptions {
	count: number;
	cyclic: boolean;
	selectOnTab: boolean;
	stopPropagation: boolean;
}

export interface MenuKeyboardResult {
	state: MenuKeyboardState;
	action: "none" | "select" | "move";
	preventDefault: boolean;
	stopImmediate: boolean;
}

/** Upstream `z24` move: from -1 jump to an end, otherwise step, clamp or wrap, and hide below 0. */
function move(state: MenuKeyboardState, delta: 1 | -1, {count, cyclic}: MenuKeyboardOptions): MenuKeyboardState {
	if (state.index === -1) {
		const index = delta === -1 ? count - 1 : 0;
		return {index, hidden: index === -1, keyboardMode: true};
	}
	let next = state.index + delta;
	if (cyclic && next === -1) {
		next = count - 1;
	}
	const index = cyclic && next > count - 1 ? 0 : Math.min(count - 1, next);
	return {index, hidden: next === -1, keyboardMode: next > -1};
}

/** Pure clone of the upstream DomKit Menu (`z24`) window keydown handler, unwrapped (no Flyout focusables). */
export function menuKeyboard(
	state: MenuKeyboardState,
	event: MenuKeyboardEvent,
	opts: MenuKeyboardOptions,
): MenuKeyboardResult {
	const stopWhenSelected = !state.hidden && state.index !== -1 && opts.stopPropagation;
	const none = (preventDefault = false): MenuKeyboardResult => ({
		state,
		action: "none",
		preventDefault,
		stopImmediate: false,
	});
	const moved = (delta: 1 | -1, stopImmediate: boolean): MenuKeyboardResult => ({
		state: move(state, delta, opts),
		action: "move",
		preventDefault: true,
		stopImmediate,
	});
	const select = (): MenuKeyboardResult => ({
		state,
		action: "select",
		preventDefault: true,
		stopImmediate: stopWhenSelected,
	});

	if (event.ctrlKey) {
		if (event.key === "p") {
			return moved(-1, stopWhenSelected);
		}
		if (event.key === "n") {
			return moved(1, stopWhenSelected);
		}
		return none();
	}
	switch (event.key) {
		case "ArrowUp":
			return event.composing ? none() : moved(-1, stopWhenSelected);
		case "ArrowDown":
			return event.composing ? none() : moved(1, stopWhenSelected);
		case "Enter":
			return event.composing || state.index < 0 ? none() : select();
		case "Tab":
			if (event.composing) {
				return none();
			}
			if (!opts.selectOnTab) {
				return moved(event.shiftKey ? -1 : 1, opts.stopPropagation);
			}
			return state.index >= 0 ? select() : none(true);
		default:
			return none();
	}
}
