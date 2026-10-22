/** The main outline's pane id; it is always rendered. */
export const MAIN_PANE_ID = "main";
/** The side pane's id while it is open. */
export const SIDE_PANE_ID = "side";

/** `paneId`'s expanded rows: the open side pane's own set, else the main outline's. */
export function paneExpandedIds(
	state: {sidePane: {expandedIds: Set<string>} | null; expandedIds: Set<string>},
	paneId: string,
): Set<string> {
	return paneId === SIDE_PANE_ID && state.sidePane !== null ? state.sidePane.expandedIds : state.expandedIds;
}
