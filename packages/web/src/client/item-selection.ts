/**
 * Pure multi-item selection model, mirroring upstream Workflowy's item selection: entries with a monotonic lead
 * order, ancestor subsumption, a ⇧-click pivot whose previous range retracts, and ⇧↑ / ⇧↓ expansion from the lead.
 */

export interface SelectionEntry {
	id: string;
	leadOrder: number;
	subsumedIds: string[];
}

export interface SelectionState {
	entries: SelectionEntry[];
	pivotId: string | null;
	retractableIds: string[];
	counter: number;
}

export interface TreeView {
	zoomRootId: string;
	parentOf(id: string): string | null;
	/** The zoom root first, then the visible rows in display order. */
	visibleOrder: string[];
	nextPotentiallyVisibleSiblingOf(id: string): string | null;
	previousPotentiallyVisibleSiblingOf(id: string): string | null;
}

export type Direction = "up" | "down";

export function emptySelection(): SelectionState {
	return {entries: [], pivotId: null, retractableIds: [], counter: 0};
}

function exists(tree: TreeView, id: string): boolean {
	return id === tree.zoomRootId || tree.parentOf(id) !== null;
}

function isDescendant(tree: TreeView, id: string, ancestorId: string): boolean {
	for (let parent = tree.parentOf(id); parent !== null; parent = tree.parentOf(parent)) {
		if (parent === ancestorId) {
			return true;
		}
	}
	return false;
}

/** The entry holding `id` itself or one of its ancestors. */
function coveringEntry(state: SelectionState, tree: TreeView, id: string): SelectionEntry | undefined {
	const ids = new Set(state.entries.map((entry) => entry.id));
	for (let current: string | null = id; current !== null; current = tree.parentOf(current)) {
		if (ids.has(current)) {
			return state.entries.find((entry) => entry.id === current);
		}
	}
	return undefined;
}

export function isCovered(state: SelectionState, tree: TreeView, id: string): boolean {
	return coveringEntry(state, tree, id) !== undefined;
}

/** Selects each id that exists and is not already covered; a selected ancestor subsumes its selected descendants. */
export function selectIds(state: SelectionState, tree: TreeView, ids: readonly string[]): SelectionState {
	let entries = state.entries;
	let counter = state.counter;
	const covered = (id: string) => isCovered({...state, entries}, tree, id);
	for (const id of ids) {
		if (!exists(tree, id) || covered(id)) {
			continue;
		}
		const subsumed = entries.filter((entry) => isDescendant(tree, entry.id, id));
		counter += 1;
		entries = [
			...entries.filter((entry) => !subsumed.includes(entry)),
			{id, leadOrder: counter, subsumedIds: subsumed.map((entry) => entry.id)},
		];
	}
	return {...state, entries, counter};
}

/** Whether `id` is itself a selection entry: the row that carries `.addedToSelection` (its nested `.project` covers the descendants). */
export function isEntry(state: SelectionState, id: string): boolean {
	return state.entries.some((entry) => entry.id === id);
}

export function removeIds(state: SelectionState, ids: readonly string[]): SelectionState {
	const removed = new Set(ids);
	return {
		...state,
		entries: state.entries.filter((entry) => !removed.has(entry.id)),
		pivotId: state.pivotId !== null && removed.has(state.pivotId) ? null : state.pivotId,
		retractableIds: state.retractableIds.filter((id) => !removed.has(id)),
	};
}

export function leadId(state: SelectionState): string | null {
	let lead: SelectionEntry | null = null;
	for (const entry of state.entries) {
		if (lead === null || entry.leadOrder > lead.leadOrder) {
			lead = entry;
		}
	}
	return lead?.id ?? null;
}

/** The selected ids in display order; ids not currently visible sort last. */
export function sortedIds(state: SelectionState, tree: TreeView): string[] {
	const position = (id: string) => {
		const index = tree.visibleOrder.indexOf(id);
		return index === -1 ? Number.POSITIVE_INFINITY : index;
	};
	return state.entries.map((entry) => entry.id).toSorted((a, b) => position(a) - position(b));
}

/** ⌘/⌥-click: remove the covering entry, else select the row and make it the pivot. */
export function toggleClick(state: SelectionState, tree: TreeView, id: string): SelectionState {
	const covering = coveringEntry(state, tree, id);
	if (covering !== undefined) {
		return removeIds(state, [covering.id]);
	}
	return {...selectIds(state, tree, [id]), pivotId: id, retractableIds: []};
}

/** The next potentially visible sibling, climbing to an ancestor's next sibling below the zoom root; never descends. */
function stepDown(tree: TreeView, id: string): string | null {
	for (
		let current: string | null = id;
		current !== null && current !== tree.zoomRootId;
		current = tree.parentOf(current)
	) {
		const sibling = tree.nextPotentiallyVisibleSiblingOf(current);
		if (sibling !== null) {
			return sibling;
		}
	}
	return null;
}

function previousVisible(tree: TreeView, id: string): string | null {
	const index = tree.visibleOrder.indexOf(id);
	return index > 0 ? (tree.visibleOrder[index - 1] ?? null) : null;
}

function expandTarget(state: SelectionState, tree: TreeView, lead: string, dir: Direction): string | null {
	if (lead === tree.zoomRootId) {
		return null;
	}
	if (dir === "down") {
		return stepDown(tree, lead);
	}
	const previous = previousVisible(tree, lead);
	if (previous !== null && isCovered(state, tree, previous)) {
		return previous;
	}
	const sibling = tree.previousPotentiallyVisibleSiblingOf(lead);
	if (sibling !== null) {
		return sibling;
	}
	const parent = tree.parentOf(lead);
	return parent !== null && tree.visibleOrder.includes(parent) ? parent : null;
}

/** ⇧↑ / ⇧↓ with an item selection, working from the lead entry. */
export function expand(state: SelectionState, tree: TreeView, dir: Direction): SelectionState {
	const lead = state.entries.find((entry) => entry.id === leadId(state));
	if (lead === undefined) {
		return state;
	}
	if (dir === "down" && lead.subsumedIds.length > 0) {
		return selectIds(removeIds(state, [lead.id]), tree, lead.subsumedIds);
	}
	const target = expandTarget(state, tree, lead.id, dir);
	if (target === null) {
		return state;
	}
	if (isCovered(state, tree, target)) {
		return removeIds(state, [lead.id]);
	}
	const selected = selectIds(state, tree, [target]);
	const leadOrders = new Map(selected.entries.map((entry) => [entry.id, entry.leadOrder]));
	let counter = selected.counter;
	const step = (id: string) => (dir === "down" ? stepDown(tree, id) : previousVisible(tree, id));
	for (let beyond = step(target); beyond !== null && leadOrders.has(beyond); beyond = step(beyond)) {
		counter += 1;
		leadOrders.set(beyond, counter);
	}
	return {
		...selected,
		entries: selected.entries.map((entry) => ({...entry, leadOrder: leadOrders.get(entry.id) ?? entry.leadOrder})),
		counter,
	};
}

/** The rows walked from `from` to `to`: down by sibling-or-ancestor's-sibling (entering `to`'s ancestors), up by visible row. */
function walk(tree: TreeView, from: string, to: string): string[] {
	const fromIndex = tree.visibleOrder.indexOf(from);
	const toIndex = tree.visibleOrder.indexOf(to);
	if (fromIndex === -1 || toIndex === -1) {
		return [to];
	}
	const rows = [from];
	let current: string | null = from;
	while (current !== null && current !== to) {
		if (toIndex < fromIndex) {
			current = previousVisible(tree, current);
		} else if (isDescendant(tree, to, current)) {
			current = tree.visibleOrder[tree.visibleOrder.indexOf(current) + 1] ?? null;
		} else {
			current = stepDown(tree, current);
		}
		if (current !== null) {
			rows.push(current);
		}
	}
	return rows;
}

/** ⇧-click: retract the previous range, then select every row walked from the pivot to `id`. */
export function pivotTo(
	state: SelectionState,
	tree: TreeView,
	id: string,
	fallbackFocusedId: string | null,
): SelectionState {
	const pivot = state.pivotId ?? leadId(state) ?? fallbackFocusedId ?? tree.visibleOrder[1] ?? null;
	if (pivot === null) {
		return state;
	}
	const retracted = removeIds(state, state.retractableIds);
	const selected = selectIds(retracted, tree, walk(tree, pivot, id));
	const before = new Set(retracted.entries.map((entry) => entry.id));
	return {
		...selected,
		pivotId: pivot,
		retractableIds: selected.entries.map((entry) => entry.id).filter((entryId) => !before.has(entryId)),
	};
}
