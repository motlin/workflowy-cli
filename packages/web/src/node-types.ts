/**
 * File-attachment metadata for a node, sourced from the `s3_files` cache table.
 */
export interface NodeAttachment {
	fileName: string;
	fileType: string;
	objectFolder: string | null;
	imageOriginalWidth: number | null;
	imageOriginalHeight: number | null;
	/** The upload's pixel density (a fractional upstream value such as 2.5); previews divide the original width by it. */
	imageOriginalPixels: number | null;
	isAnimatedGif: boolean;
	isDeleted: boolean;
}

/**
 * A node in Workflowy REST API response shape (snake_case wire format), shared by
 * the server routes that produce it and the client that consumes it.
 *
 * The derived/mirror fields are optional so client-side optimistic constructions
 * need not populate them; the server always sets them.
 */
export interface NodeResponse {
	id: string;
	parent_id: string | null;
	name: string | null;
	note: string | null;
	priority: number;
	data: {layoutMode: string | null};
	/** The first number of a numbered list (`metadata.numbered_start`), or null when unset. */
	numberedStart?: number | null;
	createdAt: number | null;
	modifiedAt: number | null;
	completedAt: number | null;
	hasChildren?: boolean;
	/** At least one child is uncompleted; with completed items hidden, this decides whether the row is a parent. */
	hasUncompletedChildren?: boolean;
	/** Upstream blocks completing a read-only item. */
	readOnly?: boolean;
	isMirror?: boolean;
	/** The node is an original with at least one live mirror (upstream `isMirrorRoot` on the original). */
	hasMirrors?: boolean;
	originalNodeId?: string | null;
	attachment?: NodeAttachment | null;
	/** Upstream `metadata.priority.defaultToBottom`: nodes dropped or moved into this one land at the bottom. */
	defaultToBottom?: boolean;
	/** Upstream `metadata.table` of a table item: header-row flag, column widths by header cell id, cell color. */
	table?: TableMetadata | null;
	/** The node is a target's hidden references root (the zoom page of its Backlinks section). */
	isReferencesRoot?: boolean;
	/** For a references root: its read-only name, "N Backlinks". */
	backlinksLabel?: string;
	/** The node's 📆 Calendar role (root or date node), or null for any other node. */
	calendar?: CalendarInfo | null;
}

/** The `metadata.table` fields the app reads and writes. */
export interface TableMetadata {
	headers?: boolean;
	/** Set by table paste: toggling the table on adds no Headers row. */
	skipHeaders?: boolean;
	sizes?: Record<string, number>;
	bg?: string;
}

/** A 📆 Calendar node's role and settings, from its upstream `metadata.calendar`. */
export interface CalendarInfo {
	/** `day` / `week` / `month` / `year` on a date node, null on the root. */
	level: string | null;
	/** `YYYYMMDD` (`YYYYMM00` for a month, `YYYY0000` for a year), null on the root. */
	dateId: number | null;
	root: boolean;
	/** Root setting: show Found Dates on day pages; null when unset (upstream treats it as on). */
	foundDates: boolean | null;
	/** Root setting: Friendly day names (Yesterday, Today, Tomorrow); null when unset (on). */
	dayPrefix: boolean | null;
	/** True on a level node the app created (upstream `restorableUniqueNode`), which upstream confines to its parent level. */
	restorableUniqueNode: boolean;
}

/** One crumb in a backlink source's ancestor path, root first. */
export interface BacklinkCrumb {
	id: string;
	name: string;
}

/** A backlink item: the mirror row (carrying its source's text and completion) and the source's ancestor crumbs. */
export interface BacklinkItem {
	node: NodeResponse;
	sourceId: string;
	/** The source's ancestors, root first, excluding the source; empty when the source is top level. */
	crumbs: BacklinkCrumb[];
}

/** An item's Backlinks section: its references root and the backlink items whose source is current. */
export interface BacklinksResponse {
	rootId: string | null;
	items: BacklinkItem[];
}

/** One parent's children in an outline view (`POST /api/v1/nodes/view`), with its Backlinks section (null for Home). */
export interface OutlineViewList {
	parentId: string | null;
	nodes: NodeResponse[];
	backlinks: BacklinksResponse | null;
}

/** An outline view's lists, the root's first, then each expanded row's in document order. */
export interface OutlineViewResponse {
	lists: OutlineViewList[];
	/** For a request with `expandedIds: null`: the listed rows the account has expanded, in list order. */
	expandedIds?: string[];
	/** For a calendar day root: its Found Dates section, so it renders in the view's swap. */
	foundDates?: FoundDatesResponse;
}

/**
 * `GET /api/v1/nodes/changes?since=<mark>`'s answer: what changed in the tree after a high-water mark, so a client
 * patches its cache after a write instead of refetching every node query.
 */
export interface NodeChangesResponse {
	/** The new high-water mark: the newest system time any node row was opened or closed at. */
	latest: string;
	/** Too much changed to list: refetch everything. The lists below are then empty. */
	reset: boolean;
	/** Every node that changed (live or gone). Empty when no `since` was given. */
	changedIds: string[];
	/** The changed nodes no longer in the tree. */
	deletedIds: string[];
	/** The refreshed children of each parent a changed node sits under now or left, Home's under `null`. */
	children: {parentId: string | null; nodes: NodeResponse[]}[];
}

/**
 * What a text save changed beyond the node's own copies: the nodes whose Backlinks gained or lost it as a
 * source, and whether its `<time>`s changed (which moves it between day pages' Found Dates).
 */
export interface SaveEffects {
	backlinkTargets: string[];
	dates: boolean;
}

/** `POST /api/v1/nodes/:id`'s answer: the saved node and what else the save changed. */
export interface UpdateNodeResponse {
	node: NodeResponse;
	effects: SaveEffects;
}

/** A Found Dates item: the found node shown as a mirror of itself, and its ancestor crumbs. */
export interface FoundDateItem {
	node: NodeResponse;
	/** The node's ancestors, root first, excluding the node; empty when it is top level. */
	crumbs: BacklinkCrumb[];
}

/** A day page's Found Dates section: nodes elsewhere whose `<time>` covers the day, in tree order. */
export interface FoundDatesResponse {
	items: FoundDateItem[];
}
