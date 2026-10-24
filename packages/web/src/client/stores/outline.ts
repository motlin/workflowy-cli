import {create} from "zustand";
import type {PickerResult} from "../location-picker-model.js";
import {MAIN_PANE_ID, canPlacePane, findPane, paneExpandedIds} from "../pane-ids.js";
import type {ItemTreePane} from "../pane-ids.js";
import {z} from "zod";
import {themeBodyClass} from "../theme-body-class.js";
import {
	emptyMainPaneHistory,
	initialNavState,
	locEquals,
	navReducer,
	rememberMainPaneMove,
	stepMainPaneHistory,
} from "../nav-stack.js";
import type {Loc, MainPaneHistory, NavAction, NavState} from "../nav-stack.js";
import {emptySelection, selectionOf} from "../item-selection.js";
import type {SelectionState} from "../item-selection.js";
import type {DropIndicator} from "../bullet-drag-state.js";
import {locationUrl, shortId} from "../location.js";
import {createPaneId, paneRuntimeState, workspaceFragments} from "../pane-url.js";
import type {PaneRuntimeState} from "../pane-url.js";
import {availablePaneWidth, paneWidth, rebalancedWidths, scaledWidths, widthFromPercent} from "../pane-widths.js";
import {caretTextOffset, editorElement} from "../caret-dom.js";
import type {PaneCaret, PaneCaretPosition} from "../pane-caret.js";
import {closeSwitcher} from "../switcher-close.js";
import {requestedMenuEntries} from "../requested-menu.js";
import type {SwitcherCloseMode, SwitcherReturn} from "../switcher-close.js";

/** Upstream's per-browser mirror of the account's `show_completed` setting, for first paint. */
const COMPLETED_MODE_STORAGE_KEY = "completedMode";
const LEGACY_SHOW_COMPLETED_STORAGE_KEY = "workflowy-show-completed";
const THEME_STORAGE_KEY = "workflowy-theme";

export type Theme = "light" | "dark" | "system";

/** A router push, e.g. react-router's `navigate`. */
export type NavigateFn = (to: string) => unknown;

type SettingsSection = "Dates";

const LeftBarModeSchema = z.enum(["drawerClosed", "drawerOpen", "alwaysOpen"]);
export type LeftBarMode = z.infer<typeof LeftBarModeSchema>;

const LEFT_BAR_MODE_STORAGE_KEY = "stateStorage::leftBarMode";
const LEFT_BAR_WIDTH_STORAGE_KEY = "stateStorage::leftBarWidth";
const LEFT_BAR_SECTION_EXPANSIONS_STORAGE_KEY = "stateStorage::leftBarSectionExpansions";
const DEFAULT_LEFT_BAR_WIDTH = 296;
const MIN_LEFT_BAR_WIDTH = 160;
/** Below this viewport width the left bar always starts as a closed drawer. */
const LEFT_BAR_PIN_MIN_VIEWPORT = 800;

export interface LeftBarPersistedState {
	leftBarMode: LeftBarMode;
	leftBarWidth: number;
	leftBarSectionExpansions: Record<string, boolean>;
}

function readStored<T>(storage: Pick<Storage, "getItem">, key: string, schema: z.ZodType<T>, fallback: T): T {
	try {
		const raw = storage.getItem(key);
		if (raw === null) {
			return fallback;
		}
		const result = schema.safeParse(JSON.parse(raw));
		return result.success ? result.data : fallback;
	} catch {
		return fallback;
	}
}

function writeStored(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Storage can be unavailable (private mode, blocked site data); state stays in memory.
	}
}

export function initialLeftBarState(storage: Pick<Storage, "getItem">, innerWidth: number): LeftBarPersistedState {
	const storedMode = readStored(storage, LEFT_BAR_MODE_STORAGE_KEY, LeftBarModeSchema, "drawerClosed");
	return {
		leftBarMode: innerWidth < LEFT_BAR_PIN_MIN_VIEWPORT ? "drawerClosed" : storedMode,
		leftBarWidth: readStored(
			storage,
			LEFT_BAR_WIDTH_STORAGE_KEY,
			z.number().min(MIN_LEFT_BAR_WIDTH),
			DEFAULT_LEFT_BAR_WIDTH,
		),
		leftBarSectionExpansions: readStored(
			storage,
			LEFT_BAR_SECTION_EXPANSIONS_STORAGE_KEY,
			z.record(z.string(), z.boolean()),
			{},
		),
	};
}

/** The hamburger and ctrl+l: unpin a pinned bar, otherwise pin it. */
export function nextLeftBarMode(mode: LeftBarMode): LeftBarMode {
	return mode === "alwaysOpen" ? "drawerClosed" : "alwaysOpen";
}

function getInitialLeftBarState(): LeftBarPersistedState {
	try {
		return initialLeftBarState(localStorage, globalThis.innerWidth);
	} catch {
		return initialLeftBarState({getItem: () => null}, globalThis.innerWidth);
	}
}

function getSystemTheme(): "light" | "dark" {
	if (typeof globalThis === "undefined") {
		return "light";
	}
	return globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialTheme(): Theme {
	const stored = localStorage.getItem(THEME_STORAGE_KEY);
	if (stored === "light" || stored === "dark" || stored === "system") {
		return stored;
	}
	return "system";
}

function applyTheme(theme: Theme): void {
	const effectiveTheme = theme === "system" ? getSystemTheme() : theme;
	document.documentElement.dataset.theme = effectiveTheme;
	const bodyClass = themeBodyClass(effectiveTheme);
	document.body.classList.toggle("_theme-dark", bodyClass === "_theme-dark");
	document.body.classList.toggle("_theme-default", bodyClass === "_theme-default");
}

function writeCompletedMode(showCompleted: boolean): void {
	try {
		localStorage.setItem(COMPLETED_MODE_STORAGE_KEY, showCompleted ? "show" : "hide");
	} catch {
		// Storage can be unavailable; the account setting still holds the value.
	}
}

/** `completedMode` (default show), migrating the old `workflowy-show-completed` key once. */
function getInitialShowCompleted(): boolean {
	try {
		const mode = localStorage.getItem(COMPLETED_MODE_STORAGE_KEY);
		if (mode === "show" || mode === "hide") {
			return mode === "show";
		}
		const legacy = localStorage.getItem(LEGACY_SHOW_COMPLETED_STORAGE_KEY);
		if (legacy === null) {
			return true;
		}
		const showCompleted = legacy !== "false";
		writeCompletedMode(showCompleted);
		localStorage.removeItem(LEGACY_SHOW_COMPLETED_STORAGE_KEY);
		return showCompleted;
	} catch {
		return true;
	}
}

/** Save the account's `show_completed`; failures keep the local value, and 503 (no internal API) stays local-only. */
/** PATCH one account preference; 503 (no internal API) keeps the value local for the session. */
async function patchPreference(patch: Record<string, boolean>, label: string): Promise<void> {
	try {
		const response = await fetch("/api/v1/preferences", {
			method: "PATCH",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify(patch),
		});
		if (!response.ok && response.status !== 503) {
			console.error(`Failed to save ${label}: ${response.status}`);
		}
	} catch (error) {
		console.error(`Failed to save ${label}`, error);
	}
}

interface LinkInsertContext {
	selectedText: string;
	nodeId: string;
	range: Range | null;
}

interface ExportContext {
	nodeIds: string[];
}

interface PresentationContext {
	nodeId: string;
	currentSlideIndex: number;
}

interface ErrorNotification {
	id: string;
	message: string;
	type: "error" | "warning" | "info";
	timestamp: number;
	retryAction?: () => void;
}

export interface AppMessageAction {
	label: string;
	/** Display-only shortcut hint, e.g. "shift+return". */
	shortcut?: string;
	run: () => void;
}

export type AppMessageType = "success" | "warning" | "failure";

/** Upstream `transient host` default: a message without a timeout hides after 5 minutes. */
const APP_MESSAGE_DEFAULT_TIMEOUT = 5 * 60 * 1000;

interface AppMessageState {
	text: string;
	type: AppMessageType;
	actions: readonly AppMessageAction[];
}

interface ShowAppMessageOptions {
	/** Milliseconds before the message hides itself; omitted is 5 minutes, 0 or less never auto-hides. */
	timeout?: number;
	/** Icon and colour; defaults to "success". */
	type?: AppMessageType;
	actions?: readonly AppMessageAction[];
	/** Window event names (e.g. "copy", "paste") that hide the message, as upstream's `dismissOn`. */
	dismissOn?: readonly string[];
}

let appMessageTimer: ReturnType<typeof setTimeout> | undefined;
let removeAppMessageDismissListeners = (): void => {};

/** Listen for each `dismissOn` window event until the message is hidden or replaced. */
function listenForDismiss(dismissOn: readonly string[], hide: () => void): () => void {
	for (const type of dismissOn) {
		globalThis.addEventListener(type, hide);
	}
	return () => {
		for (const type of dismissOn) {
			globalThis.removeEventListener(type, hide);
		}
	};
}

export interface ClickPosition {
	x: number;
	y: number;
}

export interface SearchReturn {
	nodeId: string;
	caretOffset: number;
}

/** What a menu opened by id acts on: the nodes the "Turn into..." picker would change. */
export interface MenuCmdContext {
	nodeIds: string[];
}

/** One open menu in upstream's `requested` map (`js1.requested`), keyed by menu id. */
export interface RequestedMenu {
	target: {top: number; left: number};
	cmdContext: MenuCmdContext;
	qualifiers: string[];
}

export interface LocationPickerOptions {
	/** The item being moved or created from; it is never listed as a location. */
	forItemId: string;
	/** Step 1 header, e.g. `Move To...`. */
	headerText: string;
	/** Replaces the location search: `eager` lists `search("")` with no query, `action: false` drops the create rows. */
	searcher?: {eager: boolean; action: boolean; search: (query: string) => PickerResult[]};
	/** Replaces `New` in both create rows and the step-2 header. */
	subActionName?: string;
	/** A non-null filter hides the input and drives the query. */
	getFilter?: () => string | null;
}

/** `{id}` from a chosen location, `{createdId}` from create-and-move, undefined when closed. */
type LocationPickerResult = {id: string} | {createdId: string} | undefined;

/** Upstream `createPaneId`: a fresh 11-character id no pane in the workspace uses yet. */
function uniquePaneId(taken: readonly (string | null)[]): string {
	let id = createPaneId();
	while (taken.includes(id)) {
		id = createPaneId();
	}
	return id;
}

/** Where `openPane` puts the new pane and whose expansion it starts from. */
export interface OpenPaneOptions {
	/**
	 * Upstream's workspace index, counting the main pane as 0: clamped to 1..(open panes + 1). Omitted appends the pane
	 * after the last one (New pane); Open in Pane passes the source pane's index + 1.
	 */
	index?: number;
	/** The pane the new one opens from; its expansion seeds the new pane's. Defaults to the active pane. */
	sourcePaneId?: string;
}

/** A pane as the URL names it, for `restorePanes`. */
interface RestoredPane {
	id: string;
	zoomedId: string | null;
	query: string | null;
}

/** Upstream caps each pane history at 100 locations. */
const PANE_HISTORY_LIMIT = 100;

/** Where editing resumes when the picker closes. */
export interface CaretReturn {
	nodeId: string;
	offset: number;
}

export interface LocationPickerState extends LocationPickerOptions {
	/** Caret box bottom-left, in page coordinates. */
	anchor: {x: number; y: number};
	returnTo: CaretReturn | null;
}

interface OutlineState {
	zoomedNodeId: string | null;
	expandedIds: Set<string>;
	editingId: string | null;
	/** Upstream's multi-item selection; non-empty only while no editor has the caret. */
	itemSelection: SelectionState;
	editingClickPosition: ClickPosition | null;
	/** Text offset to place the caret at when editing resumes after dismissing search. */
	editingCaretOffset: number | null;
	/** A name the next editor for `id` starts from instead of its `initialValue`; consumed when editing mounts. */
	editingHtmlOverride: {id: string; html: string} | null;
	editingNoteId: string | null;
	/** Where the focused note puts the caret when focus arrives from the keyboard or a restored pane caret. */
	editingNoteCaret: number | "end";
	/** Set while a structural shortcut moves the edited node, so the blur from re-rendering keeps editing. */
	editingHeld: boolean;
	/** The most recently edited node; panels that follow the user's place outlive the edit's blur. */
	lastEditedId: string | null;
	/** A row whose name editor should open the date picker at its caret once it is focused ("Add date"). */
	datePickerRequestId: string | null;
	showCompleted: boolean;
	/** Completed rows kept visible while their deferred hide runs, though completed rows are hidden. */
	animatingCompletionIds: Set<string>;
	/** Animating rows currently playing the slideUp. */
	slidingUpCompletionIds: Set<string>;
	/** Completed rows just revealed by showing completed, playing the slideDown. */
	slidingDownCompletedIds: Set<string>;
	/** Rows just moved (Shift+Cmd+Up/Down, a bullet drop, its collapsed parent); they carry upstream's `.moving` flash. */
	movingIds: readonly string[];
	/** Rows a bullet drag is carrying; they carry upstream's `.project.moving` until the drop. */
	draggingIds: readonly string[];
	/** Where the bullet drag's drop line goes, or null when there is no target. */
	dropIndicator: DropIndicator | null;
	/** The `stripDropKey` of the calendar strip card a bullet drag hovers, or null. */
	stripDropKey: string | null;
	/** The row whose item (bullet) menu is open; it carries upstream's `.highlighted` tint over its subtree. */
	itemMenuOpenId: string | null;
	leftBarMode: LeftBarMode;
	leftBarWidth: number;
	leftBarSectionExpansions: Record<string, boolean>;
	leftBarHovered: boolean;
	/** Upstream's account setting `show_keyboard_shortcuts`: the right bar shows the shortcuts help. */
	showKeyboardShortcuts: boolean;
	/** Whether the right bar is collapsed; always true on load and never persisted. */
	rightBarCollapsed: boolean;
	/** The node and caret being edited when Escape focused search; leaving search resumes editing there. */
	searchReturn: SearchReturn | null;
	/** Live text of the header search box (uncommitted). */
	searchInput: string;
	/** Whether the header search box has focus. */
	searchFocused: boolean;
	/** The committed search, mirrored from the URL's `?q=` ("" when none). */
	searchQuery: string;
	/** Bumped when the committed query is re-run unchanged; part of the tree-search query key. */
	searchRun: number;
	/** Bumped when the committed search is cleared, so a later search never shows the cleared one's result. */
	searchSession: number;
	/** Items created while searching stay visible though they do not match; reset per zoom and query. */
	searchCreatedIds: Set<string>;
	/** Per-item expansion overrides while searching; reset per zoom and query. */
	searchExpansion: Map<string, boolean>;
	jumpMenuOpen: boolean;
	/** The edited node and caret when the jump menu opened, restored when it is cancelled. */
	jumpMenuReturn: SwitcherReturn | null;
	linkInsertOpen: boolean;
	linkInsertContext: LinkInsertContext | null;
	relatedNodesPanelOpen: boolean;
	/** Upstream's secondary item-tree panes (New pane ⌃R, Open in Pane), left to right after the main outline. */
	panes: ItemTreePane[];
	/** The main pane's upstream id in `panes=v2.` while any pane is open; null in the single-document layout. */
	mainPaneUrlId: string | null;
	/** Upstream's pane focus history (`QM`): pane ids, most recently active last; picks the next active pane on close. */
	paneFocusHistory: string[];
	/**
	 * Upstream's `activePaneId`: the pane that last saw a pointerdown or focusin. Editing, the item selection and keyboard
	 * navigation act in it only; it is the main pane whenever no pane is open.
	 */
	activePaneId: string;
	/**
	 * Upstream's per-pane `width`, keyed by pane id (`main` for the main pane): each pane's flex share of the workspace.
	 * Empty in the single-document layout; rebalanced to equal shares whenever a pane opens or closes.
	 */
	paneWidths: Record<string, number>;
	/** Each pane's last caret, keyed like `paneWidths`; ⌃N restores it when focusing the pane (upstream's `viewState`). */
	paneCarets: Record<string, PaneCaret>;
	exportDialogOpen: boolean;
	exportContext: ExportContext | null;
	presentationOpen: boolean;
	presentationContext: PresentationContext | null;
	settingsOpen: boolean;
	/** The Settings section to scroll to when the modal opens. */
	settingsSection: SettingsSection | null;
	theme: Theme;
	isOnline: boolean;
	errorNotifications: ErrorNotification[];
	appMessage: AppMessageState | null;
	/** Menus opened by id (`showMenuById`); one open menu per id. */
	requestedMenus: Map<string, RequestedMenu>;
	/** Upstream's inline location picker (WF.InlineSearch), opened by `openLocationPicker`. */
	locationPicker: LocationPickerState | null;
	/** In-flight node mutations; the main menu's autosave footer reads "Saving..." while it is above zero (see selectIsMutating). */
	mutationCount: number;
	/** When the last in-flight mutation settled (page load until then), for the footer's "Autosaved: <ago>". */
	lastSavedAt: number;
	/** In-app Back/Forward stacks (see nav-stack.ts). */
	nav: NavState;
	/** The main pane's own Back/Forward while panes are open (upstream's `mainPaneHistory`); empty with no pane open. */
	mainPaneHistory: MainPaneHistory;
	/** The committed search from the URL's `?q=` (null when absent); the hash route keeps it in sync. */
	urlSearchQuery: string | null;
}

interface OutlineActions {
	dispatchNav: (action: NavAction) => void;
	/**
	 * Upstream's `navigateMainPaneHistory`: step the main pane history and record the move on the app stacks without
	 * remembering it again. Returns the location to navigate to, or null when that stack is empty.
	 */
	stepMainPaneHistory: (direction: "back" | "forward") => Loc | null;
	setUrlSearchQuery: (query: string | null) => void;
	zoom: (id: string | null) => void;
	/** Keeps a row created during the committed search visible though it does not match; no-op with no search. */
	markCreatedForSearch: (id: string) => void;
	toggleExpand: (id: string) => void;
	/** Arrow click during a search: record the opposite of the row's current search expansion; `expandedIds` is untouched. */
	toggleSearchExpansion: (id: string, isExpanded: boolean) => void;
	expand: (id: string) => void;
	collapse: (id: string) => void;
	/** Replace the expanded set and persist the change (Expand all / Collapse all). */
	replaceExpanded: (ids: Set<string>) => void;
	/** Replace the expanded set without persisting it (hydration from `/api/v1/expansion`). */
	setExpanded: (ids: Set<string>) => void;
	setItemSelection: (selection: SelectionState) => void;
	/** Reselects the ids an undo step saved, in lead order. */
	restoreItemSelection: (ids: readonly string[]) => void;
	clearItemSelection: () => void;
	/** Record a row's item menu opening or closing; a stale close for another row is ignored. */
	setItemMenuOpen: (id: string, open: boolean) => void;
	startEditing: (id: string, clickPosition?: ClickPosition) => void;
	stopEditing: () => void;
	/** Focus `id`'s note with the caret at its start or end (default), leaving its name (the caller commits any unsaved name text first). */
	focusNote: (id: string, caret?: number | "end") => void;
	/** Focus `id`'s name with the caret at its start or end, leaving any note. */
	focusName: (id: string, caret: 0 | "end") => void;
	/** Upstream "Add date" on an unfocused item: focus the end of `id`'s name and open the date picker there. */
	requestDatePicker: (id: string) => void;
	/** Clear and report whether the pending date-picker request is for `id`. */
	takeDatePickerRequest: (id: string) => boolean;
	/** The note `id` lost focus: clear note focus unless it already moved elsewhere. */
	blurNote: (id: string) => void;
	/** Edit `id` with the caret `caretOffset` text characters in (clamped to the end). */
	/** `options.html` is the stored name the editor must start from, for a row whose `initialValue` prop is stale. */
	resumeEditing: (id: string, caretOffset: number, options?: {html: string}) => void;
	holdEditing: (caretOffset: number) => void;
	releaseEditing: () => void;
	/** Show or hide completed rows: updates `completedMode` and PATCHes the account setting. */
	setShowCompleted: (showCompleted: boolean) => void;
	toggleShowCompleted: () => void;
	/** Take the account's value from `/api/v1/preferences` without writing it back. */
	adoptShowCompleted: (showCompleted: boolean) => void;
	startCompletedSlideDown: (ids: string[]) => void;
	endCompletedSlideDown: (ids: string[]) => void;
	beginCompletionAnimation: (ids: string[]) => void;
	startCompletionSlideUp: (ids: string[]) => void;
	endCompletionAnimation: (ids: string[]) => void;
	/** Flash `.moving` on the moved row for 500ms, restarting for each move. */
	flashMoving: (ids: readonly string[]) => void;
	setBulletDrag: (
		draggingIds: readonly string[],
		dropIndicator: DropIndicator | null,
		stripDropKey?: string | null,
	) => void;
	toggleLeftBar: () => void;
	openLeftBarDrawer: () => void;
	closeLeftBarDrawer: () => void;
	setLeftBarWidth: (width: number) => void;
	setLeftBarSectionExpanded: (key: string, value: boolean) => void;
	setLeftBarHovered: (hovered: boolean) => void;
	/** Horizontal space the pinned bar takes from the page; 0 for the drawer. */
	leftBarOffset: () => number;
	/** Set and persist `showKeyboardShortcuts` through `/api/v1/preferences`. */
	setShowKeyboardShortcuts: (on: boolean) => void;
	/** Take the account's `showKeyboardShortcuts` without writing it back. */
	adoptShowKeyboardShortcuts: (on: boolean) => void;
	toggleRightBarCollapsed: () => void;
	/** Upstream's right-bar toggle: expand and show shortcuts when collapsed, otherwise collapse and hide them. */
	toggleRightBar: () => void;
	setSearchInput: (value: string) => void;
	setSearchFocused: (focused: boolean) => void;
	/** Leave the outline for the search box, remembering the edited node and caret (`from`) to return to. */
	focusSearch: (from: SearchReturn | null) => void;
	/** Leave the search box, resuming editing at the remembered node and caret when there is one. */
	blurSearch: () => void;
	/** Upstream's `navigateToSearch`: record the zoomed node with `?q=` on the nav stacks and push its URL. */
	pushSearchLocation: (query: string, navigate: NavigateFn) => void;
	/** Commit `query`: push its URL, or re-run it when it is already the committed query. */
	commitSearch: (query: string, navigate: NavigateFn) => void;
	/** Clear the input, push the URL without `?q=` when a search is committed, then leave the search box. */
	cancelSearch: (navigate: NavigateFn) => void;
	/** Clear the input and leave the search box without a URL push, for a navigation that drops `?q=` itself. */
	leaveSearch: () => void;
	/** Open the jump menu, committing the edit by blurring and remembering its caret. */
	openJumpMenu: () => void;
	/** Close the jump menu; `cancel` returns the caret to where it was, `navigate` leaves placing it to the caller. */
	closeJumpMenu: (mode: SwitcherCloseMode) => void;
	openLinkInsert: (context: LinkInsertContext) => void;
	closeLinkInsert: () => void;
	toggleRelatedNodesPanel: () => void;
	/**
	 * Upstream's `WF.Panes.open` for an item-tree pane: insert a pane zoomed to `zoomedId` and make it active, ending
	 * editing. The first pane also gives the main pane its URL id. Returns the new pane's id.
	 */
	openPane: (zoomedId: string | null, options?: OpenPaneOptions) => string;
	/** Zoom pane `paneId`, pushing its previous zoom on its Back stack; a no-op for a pane that is not open. */
	zoomPane: (paneId: string, zoomedId: string | null) => void;
	/** Pane `paneId`'s Back: zoom to its previous location, keeping the current one for Forward. */
	paneBack: (paneId: string) => void;
	paneForward: (paneId: string) => void;
	/** Commit pane `paneId`'s search query, filtering only that pane. */
	setPaneQuery: (paneId: string, query: string) => void;
	/**
	 * Upstream's `WF.Panes.close` for a secondary pane. The active pane stays active when it remains; otherwise the most
	 * recently active remaining pane takes over and editing ends. Closing the last pane restores the single document.
	 */
	closePane: (paneId: string) => void;
	/** Close every pane (browser Back to a URL without `panes`), restoring the single document. */
	closeAllPanes: () => void;
	/**
	 * Upstream's close of the main pane: the first pane becomes the main pane (its id becomes the main URL id) and is
	 * returned, so the caller navigates the main outline to its zoom and query. Null with no panes open.
	 */
	closeMainPane: () => ItemTreePane | null;
	/**
	 * Upstream's `movePane`: move pane `paneId` (`main` for the main pane) to workspace index `index`, main first. Widths
	 * travel with their panes. Whichever pane lands first becomes the main pane: a promoted pane is returned, so the
	 * caller navigates the main outline to its zoom and query, and the old main outline becomes a pane under its URL id.
	 * Null when `canPlacePane` refuses the place.
	 */
	movePane: (paneId: string, index: number) => {promoted: ItemTreePane | null} | null;
	/**
	 * Apply the panes the URL names (reload, Back/Forward): open each, or re-zoom an open one with the same id without
	 * touching its history, and drop the rest. `activePaneId` (from `pane-workspace-runtime:v1`) activates that pane.
	 */
	restorePanes: (workspace: {
		mainPaneId: string;
		panes: RestoredPane[];
		activePaneId: string | null;
		/** `pane-workspace-runtime:v1`'s width shares, main first; absent, a changed pane set rebalances. */
		widthPercents?: readonly (number | null)[] | null;
	}) => void;
	/** Set every pane's width in workspace order, main first; ignored unless it names one width per pane. */
	setPaneWidths: (widths: readonly number[]) => void;
	/** Upstream's window resize: scale every pane to the new width beside the left bar, keeping their shares. */
	resizeToAvailableWidth: () => void;
	/** Make `paneId` the active pane; a no-op for a pane that is not open. */
	setActivePane: (paneId: string) => void;
	/** Remember `paneId`'s caret with the pane's current zoom; ignored for a pane that is not open. */
	savePaneCaret: (paneId: string, caret: PaneCaretPosition) => void;
	openExportDialog: (context: ExportContext) => void;
	closeExportDialog: () => void;
	openPresentation: (nodeId: string) => void;
	closePresentation: () => void;
	nextSlide: () => void;
	previousSlide: () => void;
	goToSlide: (index: number) => void;
	openSettings: (section?: SettingsSection) => void;
	closeSettings: () => void;
	setTheme: (theme: Theme) => void;
	setOnline: (isOnline: boolean) => void;
	addErrorNotification: (message: string, type?: "error" | "warning" | "info", retryAction?: () => void) => string;
	removeErrorNotification: (id: string) => void;
	clearAllErrorNotifications: () => void;
	showAppMessage: (text: string, options?: ShowAppMessageOptions) => void;
	hideAppMessage: () => void;
	/**
	 * Upstream's `GuiMenu.showById`: assemble the submenu flat and, when it has rows, open it at `target`;
	 * otherwise warn "Couldn't assemble menu: <id>" and open nothing.
	 */
	showMenuById: (
		menuId: string,
		target: {top: number; left: number},
		cmdContext: MenuCmdContext,
		qualifiers: readonly string[],
	) => void;
	hideMenu: (menuId: string) => void;
	/** Upstream's `showItemTypePicker`: open the "Turn into..." picker for `nodeIds` at `position`. */
	showItemTypePicker: (picker: {nodeIds: string[]; position: {top: number; left: number}}) => void;
	/** Upstream's `execute()`: open the location picker at `anchor`; resolves when it closes. */
	openLocationPicker: (
		options: LocationPickerOptions,
		anchor: {x: number; y: number},
		returnTo?: CaretReturn,
	) => Promise<LocationPickerResult>;
	/** Close the picker, resolve its promise with `result` and return the caret to `returnTo`. */
	closeLocationPicker: (result: LocationPickerResult) => void;
	beginMutation: () => void;
	endMutation: () => void;
}

type OutlineStore = OutlineActions & OutlineState;

let editFlush: (() => void) | null = null;

let resolveLocationPicker: ((result: LocationPickerResult) => void) | null = null;

/**
 * The edited row registers how to save its unsaved text in place, keeping the caret (upstream's
 * `WF.Editor.saveFocused()`). Returns the unregister function, which leaves a newer registration alone.
 */
export function registerEditFlush(flush: () => void): () => void {
	editFlush = flush;
	return () => {
		if (editFlush === flush) {
			editFlush = null;
		}
	};
}

/** Save the edited row's unsaved text without leaving it; a no-op when nothing is being edited. */
export function flushEditing(): void {
	editFlush?.();
}

/**
 * Whether a blur of `nodeId`'s editor should commit its text and stop editing.
 * Not when a structural shortcut holds editing across the re-render, and not
 * when editing already moved to another node (the mover committed the text).
 */
export function shouldCommitOnBlur(state: Pick<OutlineState, "editingId" | "editingHeld">, nodeId: string): boolean {
	return state.editingId === nodeId && !state.editingHeld;
}

/** The active pane's zoomed node: an open pane's while it is active, else the main outline's. */
export function activeZoomedId(state: Pick<OutlineState, "activePaneId" | "panes" | "zoomedNodeId">): string | null {
	const pane = findPane(state.panes, state.activePaneId);
	return pane === undefined ? state.zoomedNodeId : pane.zoomedId;
}

/** The workspace's pane ids in order: the main pane, then each open pane left to right. */
export function workspacePaneIds(state: Pick<OutlineState, "panes">): string[] {
	return [MAIN_PANE_ID, ...state.panes.map((pane) => pane.id)];
}

/** Every pane's width in workspace order, main first; empty with no pane open. */
export function workspaceWidths(state: Pick<OutlineState, "panes" | "paneWidths">): number[] {
	return state.panes.length === 0 ? [] : workspacePaneIds(state).map((id) => paneWidth(state.paneWidths[id]));
}

/** Upstream `availableWidth`: the window width beside the pinned left bar. */
function workspaceAvailableWidth(state: Pick<OutlineStore, "leftBarOffset">): number {
	return availablePaneWidth(globalThis.innerWidth, state.leftBarOffset());
}

/**
 * Upstream `startRuntimePersistence`'s `pane-workspace-runtime:v1` record for the workspace: the active pane by its URL
 * id and every pane's width share; null in the single-document layout, which removes the record.
 */
export function workspaceRuntimeState(
	state: Pick<OutlineState, "panes" | "paneWidths" | "mainPaneUrlId" | "activePaneId">,
): PaneRuntimeState | null {
	const {mainPaneUrlId, panes, activePaneId} = state;
	if (mainPaneUrlId === null || panes.length === 0) {
		return null;
	}
	const ids = [mainPaneUrlId, ...panes.map((pane) => pane.id)];
	return paneRuntimeState(ids, activePaneId === MAIN_PANE_ID ? mainPaneUrlId : activePaneId, workspaceWidths(state));
}

function widthsById(ids: readonly string[], widths: readonly number[]): Record<string, number> {
	return Object.fromEntries(ids.map((id, index) => [id, widths[index] ?? paneWidth(undefined)]));
}

/** Upstream `rebalanceWidths` over `panes`: an equal share each, the main pane included; none with no pane open. */
function rebalancedPaneWidths(panes: ItemTreePane[]): Record<string, number> {
	if (panes.length === 0) {
		return {};
	}
	const ids = workspacePaneIds({panes});
	return widthsById(ids, rebalancedWidths(ids.length, workspaceAvailableWidth(useOutlineStore.getState())));
}

function samePaneIds(a: readonly ItemTreePane[], b: readonly ItemTreePane[]): boolean {
	return a.length === b.length && a.every((pane, index) => pane.id === b[index]?.id);
}

/**
 * The store's state for its actions, which never change. A component reads its actions here once per render instead
 * of selecting each one, which would subscribe every mounted row to the store once per action for nothing.
 */
export function outlineActions(): OutlineStore {
	return useOutlineStore.getState();
}

/** The store's state as the active pane sees it: that pane's `zoomedNodeId` and `expandedIds`, for keyboard navigation. */
export function activePaneView(): OutlineStore {
	const state = useOutlineStore.getState();
	return {...state, zoomedNodeId: activeZoomedId(state), expandedIds: paneExpandedIds(state, state.activePaneId)};
}

export function selectIsMutating(state: Pick<OutlineState, "mutationCount">): boolean {
	return state.mutationCount > 0;
}

/** A modal popup is open, which keeps the selection toolbar from opening. */
export function isModalOpen(): boolean {
	const state = useOutlineStore.getState();
	return (
		state.linkInsertOpen ||
		state.jumpMenuOpen ||
		state.locationPicker !== null ||
		state.exportDialogOpen ||
		state.settingsOpen
	);
}

/** Upstream's desktop `.moving` flash length. */
const MOVING_FLASH_MS = 500;
let movingFlashTimer: ReturnType<typeof setTimeout> | undefined;

/** False once `/api/v1/expansion` answers 503: expansion then lives in memory for the session. */
let expansionPersisted = true;

export function disableExpansionPersistence(): void {
	expansionPersisted = false;
}

export function isExpansionPersisted(): boolean {
	return expansionPersisted;
}

/** How many local expansion changes have been committed, and when the latest was (ms epoch). */
let localExpansionChanges = {count: 0, at: Number.NEGATIVE_INFINITY};

export function localExpansionChangeState(): {count: number; at: number} {
	return localExpansionChanges;
}

/** `{[id]: boolean}` for every id whose expansion differs between `previous` and `next`. */
function expansionDelta(previous: ReadonlySet<string>, next: ReadonlySet<string>): Record<string, boolean> {
	const changes: Record<string, boolean> = {};
	for (const id of next) {
		if (!previous.has(id)) {
			changes[id] = true;
		}
	}
	for (const id of previous) {
		if (!next.has(id)) {
			changes[id] = false;
		}
	}
	return changes;
}

/** PATCH one expansion delta immediately; the server coalesces pushes, so the client does not debounce. */
async function patchExpansion(changes: Record<string, boolean>): Promise<void> {
	try {
		const response = await fetch("/api/v1/expansion", {
			method: "PATCH",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify({changes}),
		});
		if (response.status === 503) {
			disableExpansionPersistence();
		} else if (!response.ok) {
			console.error(`Failed to save expansion: ${response.status}`);
		}
	} catch (error) {
		console.error("Failed to save expansion", error);
	}
}

/**
 * Store `next` as the active pane's expanded set. The main outline's change is saved to the server; a pane's stays
 * in memory, like upstream's temporary mirror root.
 */
function commitExpanded(next: Set<string>): void {
	const {activePaneId, panes} = useOutlineStore.getState();
	if (findPane(panes, activePaneId) !== undefined) {
		useOutlineStore.setState({
			panes: panes.map((pane) => (pane.id === activePaneId ? {...pane, expandedIds: next} : pane)),
		});
		return;
	}
	const changes = expansionDelta(useOutlineStore.getState().expandedIds, next);
	if (Object.keys(changes).length === 0) {
		return;
	}
	useOutlineStore.setState({expandedIds: next});
	localExpansionChanges = {count: localExpansionChanges.count + 1, at: Date.now()};
	if (expansionPersisted) {
		void patchExpansion(changes);
	}
}

/** Replace open pane `paneId` with `update(pane)`; a no-op for a pane that is not open or an unchanged pane. */
function updatePane(paneId: string, update: (pane: ItemTreePane) => ItemTreePane): void {
	const {panes} = useOutlineStore.getState();
	const pane = findPane(panes, paneId);
	if (pane === undefined) {
		return;
	}
	const next = update(pane);
	if (next !== pane) {
		useOutlineStore.setState({panes: panes.map((open) => (open === pane ? next : open))});
	}
}

/**
 * Upstream's `applySnapshot` for the store's panes: set the open panes (and the main pane's URL id when given). The
 * active pane stays active while it remains; otherwise the most recently active remaining pane (upstream's `vC4`), else
 * the main pane, takes over and editing ends. No panes left restores the single document.
 */
function setWorkspace(panes: ItemTreePane[], mainPaneUrlId?: string): void {
	const state = useOutlineStore.getState();
	const ids = new Set(panes.map((pane) => pane.id));
	const history = panes.length === 0 ? [] : state.paneFocusHistory.filter((id) => id === MAIN_PANE_ID || ids.has(id));
	const remains = state.activePaneId === MAIN_PANE_ID || ids.has(state.activePaneId);
	const activePaneId = remains ? state.activePaneId : (history.at(-1) ?? MAIN_PANE_ID);
	useOutlineStore.setState({
		panes,
		...(samePaneIds(panes, state.panes) ? {} : {paneWidths: rebalancedPaneWidths(panes)}),
		mainPaneUrlId: panes.length === 0 ? null : (mainPaneUrlId ?? state.mainPaneUrlId),
		...(panes.length === 0 ? {mainPaneHistory: emptyMainPaneHistory} : {}),
		paneFocusHistory: history,
		paneCarets: Object.fromEntries(
			Object.entries(state.paneCarets).filter(([id]) => panes.length > 0 && (id === MAIN_PANE_ID || ids.has(id))),
		),
		activePaneId,
		...(remains ? {} : {editingId: null, editingClickPosition: null, editingCaretOffset: null}),
	});
}

export const useOutlineStore = create<OutlineStore>((set, get) => ({
	zoomedNodeId: null,
	expandedIds: new Set<string>(),
	editingId: null,
	itemSelection: emptySelection(),
	editingClickPosition: null,
	editingCaretOffset: null,
	editingHtmlOverride: null,
	editingNoteId: null,
	editingNoteCaret: "end",
	editingHeld: false,
	lastEditedId: null,
	datePickerRequestId: null,
	showCompleted: getInitialShowCompleted(),
	animatingCompletionIds: new Set<string>(),
	slidingUpCompletionIds: new Set<string>(),
	slidingDownCompletedIds: new Set<string>(),
	movingIds: [],
	draggingIds: [],
	dropIndicator: null,
	stripDropKey: null,
	itemMenuOpenId: null,
	...getInitialLeftBarState(),
	leftBarHovered: false,
	showKeyboardShortcuts: false,
	rightBarCollapsed: true,
	searchReturn: null,
	searchInput: "",
	searchFocused: false,
	searchQuery: "",
	searchRun: 0,
	searchSession: 0,
	searchCreatedIds: new Set(),
	searchExpansion: new Map(),
	jumpMenuOpen: false,
	jumpMenuReturn: null,
	linkInsertOpen: false,
	linkInsertContext: null,
	relatedNodesPanelOpen: false,
	panes: [],
	mainPaneUrlId: null,
	paneFocusHistory: [],
	activePaneId: MAIN_PANE_ID,
	paneWidths: {},
	paneCarets: {},
	exportDialogOpen: false,
	exportContext: null,
	presentationOpen: false,
	presentationContext: null,
	settingsOpen: false,
	settingsSection: null,
	theme: getInitialTheme(),
	isOnline: typeof navigator === "undefined" ? true : navigator.onLine,
	errorNotifications: [],
	appMessage: null,
	requestedMenus: new Map(),
	locationPicker: null,
	mutationCount: 0,
	lastSavedAt: Date.now(),
	nav: initialNavState,
	mainPaneHistory: emptyMainPaneHistory,
	urlSearchQuery: null,

	dispatchNav: (action) => {
		const {nav, appMessage, hideAppMessage, panes, mainPaneHistory} = get();
		const next = navReducer(nav, action);
		// Upstream remembers main pane moves on `location.change.before` while panes are open, Back/Forward included.
		const remember = panes.length > 0 && (action.type === "navigate" || action.type === "popstate");
		set({
			nav: next,
			mainPaneHistory: remember
				? rememberMainPaneMove(mainPaneHistory, nav.current, next.current)
				: mainPaneHistory,
		});
		// Upstream hides the app message on `location.change.before`.
		if (appMessage !== null && !locEquals(nav.current, next.current)) {
			hideAppMessage();
		}
	},

	stepMainPaneHistory: (direction) => {
		const {nav, mainPaneHistory, appMessage, hideAppMessage} = get();
		const step = stepMainPaneHistory(mainPaneHistory, nav.current, direction);
		if (step === null) {
			return null;
		}
		set({mainPaneHistory: step.history, nav: navReducer(nav, {type: "navigate", loc: step.target})});
		if (appMessage !== null) {
			hideAppMessage();
		}
		return step.target;
	},

	setUrlSearchQuery: (query) => {
		const searchQuery = query ?? "";
		if (searchQuery === get().searchQuery) {
			set({urlSearchQuery: query});
			return;
		}
		set((state) => ({
			urlSearchQuery: query,
			searchQuery,
			searchInput: searchQuery,
			searchSession: searchQuery === "" ? state.searchSession + 1 : state.searchSession,
			searchCreatedIds: new Set(),
			searchExpansion: new Map(),
		}));
	},

	markCreatedForSearch: (id) => {
		const {searchQuery, searchCreatedIds} = get();
		if (searchQuery === "" || searchCreatedIds.has(id)) {
			return;
		}
		set({searchCreatedIds: new Set(searchCreatedIds).add(id)});
	},

	zoom: (id) => {
		if (id === get().zoomedNodeId) {
			return;
		}
		set({zoomedNodeId: id, searchCreatedIds: new Set(), searchExpansion: new Map()});
	},

	toggleExpand: (id) => {
		const next = new Set(activePaneView().expandedIds);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		commitExpanded(next);
	},

	toggleSearchExpansion: (id, isExpanded) => {
		set((state) => ({searchExpansion: new Map(state.searchExpansion).set(id, !isExpanded)}));
	},

	expand: (id) => {
		commitExpanded(new Set([...activePaneView().expandedIds, id]));
	},

	collapse: (id) => {
		const next = new Set(activePaneView().expandedIds);
		next.delete(id);
		commitExpanded(next);
	},

	replaceExpanded: (ids) => {
		commitExpanded(new Set(ids));
	},

	setExpanded: (ids) => {
		set({expandedIds: new Set(ids)});
	},

	setItemSelection: (selection) => {
		set({itemSelection: selection});
	},

	restoreItemSelection: (ids) => {
		set({itemSelection: selectionOf(ids)});
	},

	clearItemSelection: () => {
		set({itemSelection: emptySelection()});
	},

	setItemMenuOpen: (id, open) => {
		if (open) {
			set({itemMenuOpenId: id});
		} else if (get().itemMenuOpenId === id) {
			set({itemMenuOpenId: null});
		}
	},

	startEditing: (id, clickPosition) => {
		set({
			itemSelection: emptySelection(),
			editingId: id,
			editingClickPosition: clickPosition ?? null,
			editingCaretOffset: null,
			lastEditedId: id,
		});
	},

	stopEditing: () => {
		set({editingId: null, editingClickPosition: null, editingCaretOffset: null});
	},

	focusNote: (id, caret = "end") => {
		set({
			itemSelection: emptySelection(),
			editingId: null,
			editingClickPosition: null,
			editingCaretOffset: null,
			editingNoteId: id,
			editingNoteCaret: caret,
			lastEditedId: id,
		});
	},

	focusName: (id, caret) => {
		set({
			itemSelection: emptySelection(),
			editingId: id,
			editingClickPosition: null,
			editingCaretOffset: caret === "end" ? Number.MAX_SAFE_INTEGER : 0,
			editingNoteId: null,
			lastEditedId: id,
		});
	},

	requestDatePicker: (id) => {
		get().focusName(id, "end");
		set({datePickerRequestId: id});
	},

	takeDatePickerRequest: (id) => {
		if (get().datePickerRequestId !== id) {
			return false;
		}
		set({datePickerRequestId: null});
		return true;
	},

	blurNote: (id) => {
		if (get().editingNoteId === id) {
			set({editingNoteId: null});
		}
	},

	resumeEditing: (id, caretOffset, options) => {
		set({
			editingHtmlOverride: options ? {id, html: options.html} : null,
			itemSelection: emptySelection(),
			editingId: id,
			editingClickPosition: null,
			editingCaretOffset: caretOffset,
			lastEditedId: id,
		});
	},

	holdEditing: (caretOffset) => {
		set({editingHeld: true, editingCaretOffset: caretOffset});
	},

	releaseEditing: () => {
		set({editingHeld: false});
	},

	setShowCompleted: (showCompleted) => {
		set({showCompleted});
		writeCompletedMode(showCompleted);
		void patchPreference({showCompleted}, "show completed");
	},

	toggleShowCompleted: () => {
		get().setShowCompleted(!get().showCompleted);
	},

	adoptShowCompleted: (showCompleted) => {
		set({showCompleted});
		writeCompletedMode(showCompleted);
	},

	startCompletedSlideDown: (ids) => {
		set((state) => ({slidingDownCompletedIds: new Set([...state.slidingDownCompletedIds, ...ids])}));
	},

	endCompletedSlideDown: (ids) => {
		const ended = new Set(ids);
		set((state) => ({
			slidingDownCompletedIds: new Set([...state.slidingDownCompletedIds].filter((id) => !ended.has(id))),
		}));
	},

	beginCompletionAnimation: (ids) => {
		set((state) => ({animatingCompletionIds: new Set([...state.animatingCompletionIds, ...ids])}));
	},

	startCompletionSlideUp: (ids) => {
		set((state) => ({slidingUpCompletionIds: new Set([...state.slidingUpCompletionIds, ...ids])}));
	},

	endCompletionAnimation: (ids) => {
		const {animatingCompletionIds, slidingUpCompletionIds} = get();
		if (!ids.some((id) => animatingCompletionIds.has(id) || slidingUpCompletionIds.has(id))) {
			return;
		}
		const ended = new Set(ids);
		set({
			animatingCompletionIds: new Set([...animatingCompletionIds].filter((id) => !ended.has(id))),
			slidingUpCompletionIds: new Set([...slidingUpCompletionIds].filter((id) => !ended.has(id))),
		});
	},

	setBulletDrag: (draggingIds, dropIndicator, stripDropKey = null) => {
		set({draggingIds, dropIndicator, stripDropKey});
	},

	flashMoving: (ids) => {
		clearTimeout(movingFlashTimer);
		set({movingIds: ids});
		movingFlashTimer = setTimeout(() => {
			set({movingIds: []});
		}, MOVING_FLASH_MS);
	},

	toggleLeftBar: () => {
		const leftBarMode = nextLeftBarMode(get().leftBarMode);
		set({leftBarMode});
		writeStored(LEFT_BAR_MODE_STORAGE_KEY, leftBarMode);
		setTimeout(() => {
			globalThis.dispatchEvent(new Event("resize"));
		}, 500);
	},

	openLeftBarDrawer: () => {
		if (get().leftBarMode === "alwaysOpen") {
			return;
		}
		set({leftBarMode: "drawerOpen"});
		writeStored(LEFT_BAR_MODE_STORAGE_KEY, "drawerOpen");
	},

	closeLeftBarDrawer: () => {
		if (get().leftBarMode === "alwaysOpen") {
			return;
		}
		set({leftBarMode: "drawerClosed"});
		writeStored(LEFT_BAR_MODE_STORAGE_KEY, "drawerClosed");
	},

	setLeftBarWidth: (width) => {
		const leftBarWidth = Math.max(MIN_LEFT_BAR_WIDTH, width);
		set({leftBarWidth});
		writeStored(LEFT_BAR_WIDTH_STORAGE_KEY, leftBarWidth);
	},

	setLeftBarSectionExpanded: (key, value) => {
		const leftBarSectionExpansions = {...get().leftBarSectionExpansions, [key]: value};
		set({leftBarSectionExpansions});
		writeStored(LEFT_BAR_SECTION_EXPANSIONS_STORAGE_KEY, leftBarSectionExpansions);
	},

	setLeftBarHovered: (leftBarHovered) => {
		set({leftBarHovered});
	},

	leftBarOffset: () => {
		const {leftBarMode, leftBarWidth} = get();
		return leftBarMode === "alwaysOpen" ? leftBarWidth : 0;
	},

	setShowKeyboardShortcuts: (on) => {
		set({showKeyboardShortcuts: on});
		void patchPreference({showKeyboardShortcuts: on}, "keyboard shortcuts");
	},

	adoptShowKeyboardShortcuts: (on) => {
		set({showKeyboardShortcuts: on});
	},

	toggleRightBarCollapsed: () => {
		set((state) => ({rightBarCollapsed: !state.rightBarCollapsed}));
	},

	toggleRightBar: () => {
		const collapsed = get().rightBarCollapsed;
		set({rightBarCollapsed: !collapsed});
		get().setShowKeyboardShortcuts(collapsed);
	},

	setSearchInput: (value) => {
		set({searchInput: value});
	},

	setSearchFocused: (focused) => {
		set({searchFocused: focused});
	},

	focusSearch: (from) => {
		set((state) => ({
			itemSelection: emptySelection(),
			editingId: null,
			editingClickPosition: null,
			editingCaretOffset: null,
			editingNoteId: null,
			lastEditedId: from?.nodeId ?? state.lastEditedId,
			searchFocused: true,
			searchReturn: from,
		}));
	},

	blurSearch: () => {
		const {searchReturn} = get();
		set({searchFocused: false, searchReturn: null});
		if (searchReturn !== null) {
			get().resumeEditing(searchReturn.nodeId, searchReturn.caretOffset);
		}
	},

	pushSearchLocation: (query, navigate) => {
		const {zoomedNodeId, dispatchNav, panes, mainPaneUrlId} = get();
		const q = query === "" ? null : query;
		dispatchNav({type: "navigate", loc: {id: zoomedNodeId === null ? null : shortId(zoomedNodeId), query: q}});
		void navigate(locationUrl({id: zoomedNodeId, query: q, fragments: workspaceFragments(panes, mainPaneUrlId)}));
	},

	commitSearch: (query, navigate) => {
		if (query === get().searchQuery) {
			set((state) => ({searchCreatedIds: new Set(), searchRun: state.searchRun + 1}));
			return;
		}
		get().pushSearchLocation(query, navigate);
	},

	cancelSearch: (navigate) => {
		set({searchInput: ""});
		if (get().searchQuery !== "") {
			get().pushSearchLocation("", navigate);
		}
		get().blurSearch();
	},

	leaveSearch: () => {
		set({searchInput: ""});
		get().blurSearch();
	},

	openJumpMenu: () => {
		const {editingId} = get();
		const editor = editingId === null ? null : editorElement(editingId);
		const saved =
			editingId === null ? null : {nodeId: editingId, caretOffset: editor ? caretTextOffset(editor) : 0};
		editor?.blur();
		set({
			jumpMenuOpen: true,
			jumpMenuReturn: saved,
			itemSelection: emptySelection(),
			editingId: null,
			editingClickPosition: null,
			editingCaretOffset: null,
		});
	},

	closeJumpMenu: (mode) => {
		const {jumpMenuOpen, jumpMenuReturn} = get();
		const {restore} = closeSwitcher({open: jumpMenuOpen, saved: jumpMenuReturn}, mode);
		set({jumpMenuOpen: false, jumpMenuReturn: null});
		if (restore !== null) {
			get().resumeEditing(restore.nodeId, restore.caretOffset);
		}
	},

	openLinkInsert: (context) => {
		set({linkInsertOpen: true, linkInsertContext: context});
	},

	closeLinkInsert: () => {
		set({linkInsertOpen: false, linkInsertContext: null});
	},

	toggleRelatedNodesPanel: () => {
		set((state) => ({relatedNodesPanelOpen: !state.relatedNodesPanelOpen}));
	},

	// Upstream focuses a new pane: editing in the previous pane ends.
	openPane: (zoomedId, options = {}) => {
		const {panes, mainPaneUrlId, activePaneId, paneFocusHistory} = get();
		const mainId = mainPaneUrlId ?? uniquePaneId(panes.map((pane) => pane.id));
		const id = uniquePaneId([mainId, ...panes.map((pane) => pane.id)]);
		const index = Math.max(1, Math.min(panes.length + 1, Math.floor(options.index ?? panes.length + 1)));
		const source = options.sourcePaneId ?? activePaneId;
		const pane: ItemTreePane = {
			id,
			zoomedId,
			backLocations: [],
			forwardLocations: [],
			query: "",
			expandedIds: new Set(paneExpandedIds(get(), source)),
		};
		const nextPanes = [...panes.slice(0, index - 1), pane, ...panes.slice(index - 1)];
		set({
			panes: nextPanes,
			paneWidths: rebalancedPaneWidths(nextPanes),
			mainPaneUrlId: mainId,
			paneFocusHistory: [...paneFocusHistory.filter((paneId) => paneId !== id), id],
			activePaneId: id,
			editingId: null,
			editingClickPosition: null,
			editingCaretOffset: null,
		});
		return id;
	},

	zoomPane: (paneId, zoomedId) => {
		updatePane(paneId, (pane) =>
			pane.zoomedId === zoomedId
				? pane
				: {
						...pane,
						zoomedId,
						backLocations: [...pane.backLocations, pane.zoomedId].slice(-PANE_HISTORY_LIMIT),
						forwardLocations: [],
						query: "",
					},
		);
	},

	paneBack: (paneId) => {
		updatePane(paneId, (pane) =>
			pane.backLocations.length === 0
				? pane
				: {
						...pane,
						zoomedId: pane.backLocations.at(-1) ?? null,
						backLocations: pane.backLocations.slice(0, -1),
						forwardLocations: [pane.zoomedId, ...pane.forwardLocations],
						query: "",
					},
		);
	},

	paneForward: (paneId) => {
		updatePane(paneId, (pane) =>
			pane.forwardLocations.length === 0
				? pane
				: {
						...pane,
						zoomedId: pane.forwardLocations[0] ?? null,
						backLocations: [...pane.backLocations, pane.zoomedId],
						forwardLocations: pane.forwardLocations.slice(1),
						query: "",
					},
		);
	},

	setPaneQuery: (paneId, query) => {
		updatePane(paneId, (pane) => (pane.query === query ? pane : {...pane, query}));
	},

	closePane: (paneId) => {
		const {panes} = get();
		if (findPane(panes, paneId) !== undefined) {
			setWorkspace(panes.filter((pane) => pane.id !== paneId));
		}
	},

	closeAllPanes: () => {
		if (get().panes.length > 0) {
			setWorkspace([]);
		}
	},

	// Upstream's applySnapshot: the old first pane (main) is gone, so the new first pane is active.
	closeMainPane: () => {
		const [promoted, ...rest] = get().panes;
		if (promoted === undefined) {
			return null;
		}
		const promotedCaret = get().paneCarets[promoted.id];
		setWorkspace(rest, promoted.id);
		const {[MAIN_PANE_ID]: _closed, ...carets} = get().paneCarets;
		set({paneCarets: promotedCaret === undefined ? carets : {...carets, [MAIN_PANE_ID]: promotedCaret}});
		if (get().activePaneId !== MAIN_PANE_ID) {
			set({activePaneId: MAIN_PANE_ID, editingId: null, editingClickPosition: null, editingCaretOffset: null});
		}
		return promoted;
	},

	movePane: (paneId, index) => {
		const state = get();
		if (!canPlacePane(state, paneId, index)) {
			return null;
		}
		const {panes, mainPaneUrlId, paneWidths, activePaneId, paneFocusHistory} = state;
		const from = workspacePaneIds(state).indexOf(paneId);
		if (from === index || mainPaneUrlId === null) {
			return {promoted: null};
		}
		const main: ItemTreePane = {
			id: mainPaneUrlId,
			zoomedId: state.zoomedNodeId,
			backLocations: [],
			forwardLocations: [],
			query: state.searchQuery,
			expandedIds: new Set(state.expandedIds),
		};
		const entries = [main, ...panes];
		const [moved] = entries.splice(from, 1);
		if (moved !== undefined) {
			entries.splice(index, 0, moved);
		}
		const [first, ...rest] = entries;
		if (first === undefined || first === main) {
			set({panes: rest});
			return {promoted: null};
		}
		// The promoted pane takes the `main` key; the old main outline goes by its URL id.
		const rename = (id: string): string =>
			id === first.id ? MAIN_PANE_ID : id === MAIN_PANE_ID ? mainPaneUrlId : id;
		set({
			panes: rest,
			mainPaneUrlId: first.id,
			paneWidths: Object.fromEntries(Object.entries(paneWidths).map(([id, width]) => [rename(id), width])),
			paneCarets: Object.fromEntries(Object.entries(state.paneCarets).map(([id, caret]) => [rename(id), caret])),
			activePaneId: rename(activePaneId),
			paneFocusHistory: paneFocusHistory.map(rename),
			editingId: null,
			editingClickPosition: null,
			editingCaretOffset: null,
		});
		return {promoted: first};
	},

	restorePanes: ({mainPaneId, panes: restored, activePaneId, widthPercents}) => {
		const {panes, expandedIds} = get();
		const next = restored.map((url): ItemTreePane => {
			const open = findPane(panes, url.id);
			const query = url.query ?? "";
			return open === undefined
				? {
						id: url.id,
						zoomedId: url.zoomedId,
						backLocations: [],
						forwardLocations: [],
						query,
						expandedIds: new Set(expandedIds),
					}
				: {...open, zoomedId: url.zoomedId, query};
		});
		setWorkspace(next, mainPaneId);
		if (widthPercents?.length === next.length + 1) {
			const available = workspaceAvailableWidth(get());
			set({
				paneWidths: widthsById(
					workspacePaneIds({panes: next}),
					widthPercents.map((percent) => widthFromPercent(percent, available)),
				),
			});
		}
		if (
			activePaneId !== null &&
			activePaneId !== get().activePaneId &&
			findPane(next, activePaneId) !== undefined
		) {
			get().setActivePane(activePaneId);
			set({editingId: null, editingClickPosition: null, editingCaretOffset: null});
		}
	},

	setPaneWidths: (widths) => {
		const state = get();
		const ids = workspacePaneIds(state);
		if (state.panes.length > 0 && widths.length === ids.length) {
			set({paneWidths: widthsById(ids, widths)});
		}
	},

	resizeToAvailableWidth: () => {
		const state = get();
		if (state.panes.length > 0) {
			state.setPaneWidths(scaledWidths(workspaceWidths(state), workspaceAvailableWidth(state)));
		}
	},

	setActivePane: (paneId) => {
		const {panes, paneFocusHistory} = get();
		if (paneId === MAIN_PANE_ID || findPane(panes, paneId) !== undefined) {
			set({
				activePaneId: paneId,
				paneFocusHistory: [...paneFocusHistory.filter((id) => id !== paneId), paneId],
			});
		}
	},

	savePaneCaret: (paneId, caret) => {
		const state = get();
		const pane = findPane(state.panes, paneId);
		if (paneId !== MAIN_PANE_ID && pane === undefined) {
			return;
		}
		const zoomedId = pane === undefined ? state.zoomedNodeId : pane.zoomedId;
		set({paneCarets: {...state.paneCarets, [paneId]: {...caret, zoomedId}}});
	},

	openExportDialog: (context) => {
		set({exportDialogOpen: true, exportContext: context});
	},

	closeExportDialog: () => {
		set({exportDialogOpen: false, exportContext: null});
	},

	openPresentation: (nodeId) => {
		set({
			presentationOpen: true,
			presentationContext: {nodeId, currentSlideIndex: 0},
		});
	},

	closePresentation: () => {
		set({presentationOpen: false, presentationContext: null});
	},

	nextSlide: () => {
		set((state) => {
			if (!state.presentationContext) {
				return state;
			}
			return {
				presentationContext: {
					...state.presentationContext,
					currentSlideIndex: state.presentationContext.currentSlideIndex + 1,
				},
			};
		});
	},

	previousSlide: () => {
		set((state) => {
			if (!state.presentationContext) {
				return state;
			}
			const newIndex = Math.max(0, state.presentationContext.currentSlideIndex - 1);
			return {
				presentationContext: {
					...state.presentationContext,
					currentSlideIndex: newIndex,
				},
			};
		});
	},

	goToSlide: (index) => {
		set((state) => {
			if (!state.presentationContext) {
				return state;
			}
			return {
				presentationContext: {
					...state.presentationContext,
					currentSlideIndex: Math.max(0, index),
				},
			};
		});
	},

	openSettings: (section) => {
		set({settingsOpen: true, settingsSection: section ?? null});
	},

	closeSettings: () => {
		set({settingsOpen: false, settingsSection: null});
	},

	setTheme(theme) {
		localStorage.setItem(THEME_STORAGE_KEY, theme);
		applyTheme(theme);
		set({theme});
	},

	setOnline: (isOnline) => {
		set({isOnline});
	},

	addErrorNotification(message, type = "error", retryAction) {
		const id = `error-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
		const notification: ErrorNotification = {
			id,
			message,
			type,
			timestamp: Date.now(),
			retryAction,
		};
		set((state) => ({
			errorNotifications: [...state.errorNotifications, notification],
		}));
		// Auto-dismiss after 8 seconds for non-error notifications
		if (type !== "error") {
			setTimeout(() => {
				get().removeErrorNotification(id);
			}, 8000);
		}
		return id;
	},

	removeErrorNotification: (id) => {
		set((state) => ({
			errorNotifications: state.errorNotifications.filter((n) => n.id !== id),
		}));
	},

	clearAllErrorNotifications: () => {
		set({errorNotifications: []});
	},

	showAppMessage(text, {timeout = APP_MESSAGE_DEFAULT_TIMEOUT, type = "success", actions = [], dismissOn = []} = {}) {
		clearTimeout(appMessageTimer);
		removeAppMessageDismissListeners();
		removeAppMessageDismissListeners = listenForDismiss(dismissOn, () => {
			get().hideAppMessage();
		});
		appMessageTimer =
			timeout > 0
				? setTimeout(() => {
						get().hideAppMessage();
					}, timeout)
				: undefined;
		set({appMessage: {text, type, actions}});
	},

	hideAppMessage() {
		clearTimeout(appMessageTimer);
		appMessageTimer = undefined;
		removeAppMessageDismissListeners();
		removeAppMessageDismissListeners = () => {};
		set({appMessage: null});
	},

	showMenuById: (menuId, target, cmdContext, qualifiers) => {
		if (requestedMenuEntries(menuId, cmdContext, qualifiers).length === 0) {
			get().showAppMessage(`Couldn't assemble menu: ${menuId}`);
			return;
		}
		set((state) => ({
			requestedMenus: new Map(state.requestedMenus).set(menuId, {
				target,
				cmdContext,
				qualifiers: [...qualifiers],
			}),
		}));
	},

	hideMenu: (menuId) => {
		set((state) => {
			const requestedMenus = new Map(state.requestedMenus);
			requestedMenus.delete(menuId);
			return {requestedMenus};
		});
	},

	showItemTypePicker: ({nodeIds, position}) => {
		get().showMenuById("node_type_picker", position, {nodeIds}, []);
	},

	openLocationPicker: async (options, anchor, returnTo) => {
		resolveLocationPicker?.(undefined);
		return new Promise<LocationPickerResult>((resolve) => {
			resolveLocationPicker = resolve;
			set({locationPicker: {...options, anchor, returnTo: returnTo ?? null}});
		});
	},

	closeLocationPicker: (result) => {
		const returnTo = get().locationPicker?.returnTo ?? null;
		const resolve = resolveLocationPicker;
		resolveLocationPicker = null;
		set({locationPicker: null});
		if (returnTo !== null) {
			get().resumeEditing(returnTo.nodeId, returnTo.offset);
		}
		resolve?.(result);
	},

	beginMutation: () => {
		set((state) => ({mutationCount: state.mutationCount + 1}));
	},

	endMutation: () => {
		set((state) => {
			const mutationCount = Math.max(0, state.mutationCount - 1);
			return mutationCount === 0 ? {mutationCount, lastSavedAt: Date.now()} : {mutationCount};
		});
	},
}));

// Apply initial theme on load and set up event listeners
if (typeof globalThis !== "undefined") {
	const initialTheme = getInitialTheme();
	applyTheme(initialTheme);

	// Listen for system theme changes when theme is set to 'system'
	globalThis.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
		const currentTheme = useOutlineStore.getState().theme;
		if (currentTheme === "system") {
			applyTheme("system");
		}
	});

	// Listen for online/offline events
	globalThis.addEventListener("online", () => {
		useOutlineStore.getState().setOnline(true);
		useOutlineStore.getState().addErrorNotification("Connection restored", "info");
	});

	globalThis.addEventListener("offline", () => {
		useOutlineStore.getState().setOnline(false);
	});
}
