/**
 * File-attachment metadata for a node, sourced from the `s3_files` cache table.
 */
export interface NodeAttachment {
	fileName: string;
	fileType: string;
	objectFolder: string | null;
	imageOriginalWidth: number | null;
	imageOriginalHeight: number | null;
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
	isMirror?: boolean;
	/** The node is an original with at least one live mirror (upstream `isMirrorRoot` on the original). */
	hasMirrors?: boolean;
	originalNodeId?: string | null;
	attachment?: NodeAttachment | null;
	/** Upstream `metadata.priority.defaultToBottom`: nodes dropped or moved into this one land at the bottom. */
	defaultToBottom?: boolean;
	/** The node's 📆 Calendar role (root or date node), or null for any other node. */
	calendar?: CalendarInfo | null;
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
