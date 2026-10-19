/** The tree queries expansion needs; "visible" means rendered under the current Show completed setting. */
export interface TreeIndex {
	children(id: string): string[];
	isVisible(id: string): boolean;
	hasVisibleChildren(id: string): boolean;
}

/** One currently rendered flattened row. */
export interface ExpansionRow {
	id: string;
	depth: number;
	hasVisibleChildren: boolean;
}

export type DoublePressResult = {double: false} | {double: true; wasOpenAtFirst: boolean};

export interface DoublePressDetector {
	press(id: string, isOpen: boolean, now: number): DoublePressResult;
}

/** The root plus every descendant reached through visible items; hidden subtrees are skipped (upstream `xp4`). */
export function subtreeIds(index: TreeIndex, rootId: string): string[] {
	const ids: string[] = [];
	const walk = (id: string) => {
		ids.push(id);
		for (const child of index.children(id)) {
			if (index.isVisible(child)) {
				walk(child);
			}
		}
	};
	walk(rootId);
	return ids;
}

/** Upstream `expandOrCollapseAll(item, open)`: sets the expansion of the item and its visible subtree. */
export function expandOrCollapseAll(
	expanded: ReadonlySet<string>,
	index: TreeIndex,
	rootId: string,
	open: boolean,
): Set<string> {
	const next = new Set(expanded);
	for (const id of subtreeIds(index, rootId)) {
		if (!open) {
			next.delete(id);
		} else if (index.hasVisibleChildren(id)) {
			next.add(id);
		}
	}
	return next;
}

/** Zoom-root ⌘↓: expands every collapsed rendered parent at the minimum depth. */
export function expandShallowestCollapsedLevel(
	expanded: ReadonlySet<string>,
	rows: readonly ExpansionRow[],
): Set<string> {
	const collapsed = rows.filter((row) => row.hasVisibleChildren && !expanded.has(row.id));
	const next = new Set(expanded);
	if (collapsed.length === 0) {
		return next;
	}
	const depth = Math.min(...collapsed.map((row) => row.depth));
	for (const row of collapsed) {
		if (row.depth === depth) {
			next.add(row.id);
		}
	}
	return next;
}

/** Zoom-root ⌘↑: collapses every open rendered parent at the maximum depth. */
export function collapseDeepestOpenLevel(expanded: ReadonlySet<string>, rows: readonly ExpansionRow[]): Set<string> {
	const open = rows.filter((row) => row.hasVisibleChildren && expanded.has(row.id));
	const next = new Set(expanded);
	if (open.length === 0) {
		return next;
	}
	const depth = Math.max(...open.map((row) => row.depth));
	for (const row of open) {
		if (row.depth === depth) {
			next.delete(row.id);
		}
	}
	return next;
}

/** ⌃Space on the zoom root expands the whole page when this is true, else collapses it. */
export function pageHasCollapsed(expanded: ReadonlySet<string>, rows: readonly ExpansionRow[]): boolean {
	return rows.some((row) => row.hasVisibleChildren && !expanded.has(row.id));
}

/** Pairs two presses on the same id within `windowMs`; the direction comes from the state at the first press. */
export function createDoublePressDetector(windowMs = 250): DoublePressDetector {
	let first: {id: string; isOpen: boolean; at: number} | null = null;
	return {
		press(id, isOpen, now) {
			if (first?.id === id && now - first.at <= windowMs) {
				const wasOpenAtFirst = first.isOpen;
				first = null;
				return {double: true, wasOpenAtFirst};
			}
			first = {id, isOpen, at: now};
			return {double: false};
		},
	};
}

/** The mac combos for the three expansion commands (`expand`, `collapse`, `expand_or_collapse`). */
export const EXPAND_KEYS = {expand: "meta+down", collapse: "meta+up", toggle: "ctrl+space"} as const;

export type ExpandKey = keyof typeof EXPAND_KEYS;

export interface ExpandKeyInput {
	key: ExpandKey;
	/** The edited row, or the zoom root (its title, or nothing edited). */
	target: "row" | "root";
	id: string;
	isOpen: boolean;
	hasVisibleChildren: boolean;
	now: number;
	detector: DoublePressDetector;
	/** The rendered rows under the zoom root, for the root's level and page-wide behavior. */
	rows: readonly ExpansionRow[];
	expanded: ReadonlySet<string>;
}

export type ExpandKeyPlan =
	| {type: "none"}
	| {type: "expand" | "collapse" | "toggle"; id: string}
	| {type: "all"; id: string; open: boolean}
	| {type: "level"; ids: string[]; open: boolean};

const NONE: ExpandKeyPlan = {type: "none"};

/** Ids `next` adds to (open) or removes from (closed) `expanded`, in row order. */
function levelIds(expanded: ReadonlySet<string>, next: ReadonlySet<string>, rows: readonly ExpansionRow[]): string[] {
	return rows.filter((row) => expanded.has(row.id) !== next.has(row.id)).map((row) => row.id);
}

/**
 * Upstream ⌘↓ / ⌘↑ / ⌃Space. On a row: expand or collapse it (no-op when already so or a leaf), and ⌃Space
 * toggles, with a second press on the same row inside the window expanding or collapsing its whole subtree,
 * opposite to the state before the first press. On the zoom root: ⌘↓ opens the shallowest collapsed level,
 * ⌘↑ closes the deepest open level, and ⌃Space expands the whole page while anything is collapsed, else collapses it.
 */
export function planExpandKey(input: ExpandKeyInput): ExpandKeyPlan {
	const {key, id, expanded, rows} = input;
	if (input.target === "root") {
		if (key === "toggle") {
			return {type: "all", id, open: pageHasCollapsed(expanded, rows)};
		}
		const open = key === "expand";
		const next = open ? expandShallowestCollapsedLevel(expanded, rows) : collapseDeepestOpenLevel(expanded, rows);
		const ids = levelIds(expanded, next, rows);
		return ids.length === 0 ? NONE : {type: "level", ids, open};
	}
	if (!input.hasVisibleChildren) {
		return NONE;
	}
	if (key === "toggle") {
		const press = input.detector.press(id, input.isOpen, input.now);
		return press.double ? {type: "all", id, open: !press.wasOpenAtFirst} : {type: "toggle", id};
	}
	if ((key === "expand") === input.isOpen) {
		return NONE;
	}
	return {type: key, id};
}
