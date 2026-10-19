import {create} from "zustand";
import {z} from "zod";
import {themeBodyClass} from "../theme-body-class.js";
import {initialNavState, navReducer} from "../nav-stack.js";
import type {NavAction, NavState} from "../nav-stack.js";

const StringArraySchema = z.array(z.string());

/** Upstream's per-browser mirror of the account's `show_completed` setting, for first paint. */
const COMPLETED_MODE_STORAGE_KEY = "completedMode";
const LEGACY_SHOW_COMPLETED_STORAGE_KEY = "workflowy-show-completed";
const THEME_STORAGE_KEY = "workflowy-theme";
const RECENT_SEARCHES_STORAGE_KEY = "workflowy-recent-searches";
const RECENT_SEARCHES_LIMIT = 10;

export type Theme = "light" | "dark" | "system";

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
async function patchShowCompleted(showCompleted: boolean): Promise<void> {
	try {
		const response = await fetch("/api/v1/preferences", {
			method: "PATCH",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify({showCompleted}),
		});
		if (!response.ok && response.status !== 503) {
			console.error(`Failed to save show completed: ${response.status}`);
		}
	} catch (error) {
		console.error("Failed to save show completed", error);
	}
}

function getInitialRecentSearches(): string[] {
	const stored = localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY);
	if (stored === null) {
		return [];
	}
	const result = StringArraySchema.safeParse(JSON.parse(stored));
	return result.success ? result.data : [];
}

interface LinkInsertContext {
	selectedText: string;
	nodeId: string;
	range: Range | null;
}

interface MoveAssistantContext {
	nodeId: string;
	nodeName: string;
	mode: "move" | "copy";
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

interface AppMessageState {
	text: string;
	actions: readonly AppMessageAction[];
}

interface ShowAppMessageOptions {
	/** Milliseconds before the message hides itself; omitted keeps it until hidden. */
	timeout?: number;
	actions?: readonly AppMessageAction[];
}

let appMessageTimer: ReturnType<typeof setTimeout> | undefined;

interface ClickPosition {
	x: number;
	y: number;
}

interface SearchReturn {
	nodeId: string;
	caretOffset: number;
}

/** Where the shared item-type picker is open and which items it turns into the chosen type. */
interface ItemTypePickerState {
	nodeIds: string[];
	position: {top: number; left: number};
}

interface OutlineState {
	zoomedNodeId: string | null;
	expandedIds: Set<string>;
	editingId: string | null;
	editingClickPosition: ClickPosition | null;
	/** Text offset to place the caret at when editing resumes after dismissing search. */
	editingCaretOffset: number | null;
	editingNoteId: string | null;
	/** Where the focused note puts the caret when focus arrives from the keyboard. */
	editingNoteCaret: 0 | "end";
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
	/** The row a single-row Shift+Cmd+Up/Down just moved; it carries upstream's `.moving` flash. */
	movingId: string | null;
	leftBarMode: LeftBarMode;
	leftBarWidth: number;
	leftBarSectionExpansions: Record<string, boolean>;
	leftBarHovered: boolean;
	rightSidebarOpen: boolean;
	searchPanelOpen: boolean;
	searchInitialQuery: string | null;
	/** Bumped on every open request; the panel remounts per session so each request starts fresh. */
	searchPanelSession: number;
	/** The node being edited when Escape opened search; dismissing search resumes editing it. */
	searchReturn: SearchReturn | null;
	/** Live text of the header search box (uncommitted). */
	searchInput: string;
	/** Whether the header search box has focus. */
	searchFocused: boolean;
	jumpMenuOpen: boolean;
	linkInsertOpen: boolean;
	linkInsertContext: LinkInsertContext | null;
	recentSearches: string[];
	relatedNodesPanelOpen: boolean;
	moveAssistantOpen: boolean;
	moveAssistantContext: MoveAssistantContext | null;
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
	itemTypePicker: ItemTypePickerState | null;
	/** In-flight node mutations; the saving overlay shows while it is above zero (see selectIsMutating). */
	mutationCount: number;
	/** In-app Back/Forward stacks (see nav-stack.ts). */
	nav: NavState;
	/** The committed search from the URL's `?q=` (null when absent); the hash route keeps it in sync. */
	urlSearchQuery: string | null;
}

interface OutlineActions {
	dispatchNav: (action: NavAction) => void;
	setUrlSearchQuery: (query: string | null) => void;
	zoom: (id: string | null) => void;
	toggleExpand: (id: string) => void;
	expand: (id: string) => void;
	collapse: (id: string) => void;
	/** Replace the expanded set and persist the change (Expand all / Collapse all). */
	replaceExpanded: (ids: Set<string>) => void;
	/** Replace the expanded set without persisting it (hydration from `/api/v1/expansion`). */
	setExpanded: (ids: Set<string>) => void;
	startEditing: (id: string, clickPosition?: ClickPosition) => void;
	stopEditing: () => void;
	/** Focus `id`'s note with the caret at its start or end (default), leaving its name (the caller commits any unsaved name text first). */
	focusNote: (id: string, caret?: 0 | "end") => void;
	/** Focus `id`'s name with the caret at its start or end, leaving any note. */
	focusName: (id: string, caret: 0 | "end") => void;
	/** Upstream "Add date" on an unfocused item: focus the end of `id`'s name and open the date picker there. */
	requestDatePicker: (id: string) => void;
	/** Clear and report whether the pending date-picker request is for `id`. */
	takeDatePickerRequest: (id: string) => boolean;
	/** The note `id` lost focus: clear note focus unless it already moved elsewhere. */
	blurNote: (id: string) => void;
	/** Edit `id` with the caret `caretOffset` text characters in (clamped to the end). */
	resumeEditing: (id: string, caretOffset: number) => void;
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
	flashMoving: (id: string) => void;
	toggleLeftBar: () => void;
	openLeftBarDrawer: () => void;
	closeLeftBarDrawer: () => void;
	setLeftBarWidth: (width: number) => void;
	setLeftBarSectionExpanded: (key: string, value: boolean) => void;
	setLeftBarHovered: (hovered: boolean) => void;
	/** Horizontal space the pinned bar takes from the page; 0 for the drawer. */
	leftBarOffset: () => number;
	toggleRightSidebar: () => void;
	addRecentSearch: (query: string) => void;
	clearRecentSearches: () => void;
	toggleSearchPanel: () => void;
	openSearchFromEditing: (nodeId: string, caretOffset: number) => void;
	dismissSearchPanel: () => void;
	openSearchWithQuery: (query: string) => void;
	setSearchInput: (value: string) => void;
	setSearchFocused: (focused: boolean) => void;
	toggleJumpMenu: () => void;
	openLinkInsert: (context: LinkInsertContext) => void;
	closeLinkInsert: () => void;
	toggleRelatedNodesPanel: () => void;
	openMoveAssistant: (context: MoveAssistantContext) => void;
	closeMoveAssistant: () => void;
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
	/** Upstream's `showItemTypePicker`: open the one shared item-type picker for `nodeIds` at `position`. */
	showItemTypePicker: (picker: ItemTypePickerState) => void;
	hideItemTypePicker: () => void;
	beginMutation: () => void;
	endMutation: () => void;
}

type OutlineStore = OutlineActions & OutlineState;

let editFlush: (() => void) | null = null;

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

export function selectIsMutating(state: Pick<OutlineState, "mutationCount">): boolean {
	return state.mutationCount > 0;
}

/** Upstream's desktop `.moving` flash length. */
const MOVING_FLASH_MS = 500;
let movingFlashTimer: ReturnType<typeof setTimeout> | undefined;

/** False once `/api/v1/expansion` answers 503: expansion then lives in memory for the session. */
let expansionPersisted = true;

export function disableExpansionPersistence(): void {
	expansionPersisted = false;
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

/** Store `next` as the expanded set and persist the change. */
function commitExpanded(next: Set<string>): void {
	const changes = expansionDelta(useOutlineStore.getState().expandedIds, next);
	if (Object.keys(changes).length === 0) {
		return;
	}
	useOutlineStore.setState({expandedIds: next});
	if (expansionPersisted) {
		void patchExpansion(changes);
	}
}

export const useOutlineStore = create<OutlineStore>((set, get) => ({
	zoomedNodeId: null,
	expandedIds: new Set<string>(),
	editingId: null,
	editingClickPosition: null,
	editingCaretOffset: null,
	editingNoteId: null,
	editingNoteCaret: "end",
	editingHeld: false,
	lastEditedId: null,
	datePickerRequestId: null,
	showCompleted: getInitialShowCompleted(),
	animatingCompletionIds: new Set<string>(),
	slidingUpCompletionIds: new Set<string>(),
	slidingDownCompletedIds: new Set<string>(),
	movingId: null,
	...getInitialLeftBarState(),
	leftBarHovered: false,
	rightSidebarOpen: false,
	searchPanelOpen: false,
	searchInitialQuery: null,
	searchPanelSession: 0,
	searchReturn: null,
	searchInput: "",
	searchFocused: false,
	jumpMenuOpen: false,
	linkInsertOpen: false,
	linkInsertContext: null,
	recentSearches: getInitialRecentSearches(),
	relatedNodesPanelOpen: false,
	moveAssistantOpen: false,
	moveAssistantContext: null,
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
	itemTypePicker: null,
	mutationCount: 0,
	nav: initialNavState,
	urlSearchQuery: null,

	dispatchNav: (action) => {
		set((state) => ({nav: navReducer(state.nav, action)}));
	},

	setUrlSearchQuery: (query) => {
		set({urlSearchQuery: query});
	},

	zoom: (id) => {
		set({zoomedNodeId: id});
	},

	toggleExpand: (id) => {
		const next = new Set(get().expandedIds);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		commitExpanded(next);
	},

	expand: (id) => {
		commitExpanded(new Set([...get().expandedIds, id]));
	},

	collapse: (id) => {
		const next = new Set(get().expandedIds);
		next.delete(id);
		commitExpanded(next);
	},

	replaceExpanded: (ids) => {
		commitExpanded(new Set(ids));
	},

	setExpanded: (ids) => {
		set({expandedIds: new Set(ids)});
	},

	startEditing: (id, clickPosition) => {
		set({
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

	resumeEditing: (id, caretOffset) => {
		set({editingId: id, editingClickPosition: null, editingCaretOffset: caretOffset, lastEditedId: id});
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
		void patchShowCompleted(showCompleted);
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

	flashMoving: (id) => {
		clearTimeout(movingFlashTimer);
		set({movingId: id});
		movingFlashTimer = setTimeout(() => {
			set({movingId: null});
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

	toggleRightSidebar: () => {
		set((state) => ({rightSidebarOpen: !state.rightSidebarOpen}));
	},

	addRecentSearch: (query) => {
		set((state) => {
			const trimmedQuery = query.trim();
			if (!trimmedQuery) {
				return state;
			}
			// Remove existing occurrence if present, then prepend
			const filtered = state.recentSearches.filter((s) => s !== trimmedQuery);
			const newRecentSearches = [trimmedQuery, ...filtered].slice(0, RECENT_SEARCHES_LIMIT);
			localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(newRecentSearches));
			return {recentSearches: newRecentSearches};
		});
	},

	clearRecentSearches() {
		localStorage.removeItem(RECENT_SEARCHES_STORAGE_KEY);
		set({recentSearches: []});
	},

	toggleSearchPanel: () => {
		set((state) => ({
			searchPanelOpen: !state.searchPanelOpen,
			searchInitialQuery: null,
			searchPanelSession: state.searchPanelSession + 1,
			searchReturn: null,
		}));
	},

	openSearchFromEditing: (nodeId, caretOffset) => {
		set((state) => ({
			editingId: null,
			editingClickPosition: null,
			editingCaretOffset: null,
			lastEditedId: nodeId,
			searchPanelOpen: true,
			searchInitialQuery: null,
			searchPanelSession: state.searchPanelSession + 1,
			searchReturn: {nodeId, caretOffset},
		}));
	},

	dismissSearchPanel: () => {
		set((state) => {
			const closed = {searchPanelOpen: false, searchInitialQuery: null, searchReturn: null};
			if (state.searchReturn === null) {
				return closed;
			}
			const {nodeId, caretOffset} = state.searchReturn;
			return {
				...closed,
				editingId: nodeId,
				editingClickPosition: null,
				editingCaretOffset: caretOffset,
				lastEditedId: nodeId,
			};
		});
	},

	openSearchWithQuery: (query) => {
		set((state) => ({
			searchPanelOpen: true,
			searchInitialQuery: query,
			searchPanelSession: state.searchPanelSession + 1,
			searchReturn: null,
		}));
	},

	setSearchInput: (value) => {
		set({searchInput: value});
	},

	setSearchFocused: (focused) => {
		set({searchFocused: focused});
	},

	toggleJumpMenu: () => {
		set((state) => ({jumpMenuOpen: !state.jumpMenuOpen}));
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

	openMoveAssistant: (context) => {
		set({moveAssistantOpen: true, moveAssistantContext: context});
	},

	closeMoveAssistant: () => {
		set({moveAssistantOpen: false, moveAssistantContext: null});
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

	showAppMessage(text, {timeout, actions = []} = {}) {
		clearTimeout(appMessageTimer);
		appMessageTimer =
			timeout === undefined
				? undefined
				: setTimeout(() => {
						get().hideAppMessage();
					}, timeout);
		set({appMessage: {text, actions}});
	},

	hideAppMessage() {
		clearTimeout(appMessageTimer);
		appMessageTimer = undefined;
		set({appMessage: null});
	},

	showItemTypePicker: (picker) => {
		set({itemTypePicker: picker});
	},

	hideItemTypePicker: () => {
		set({itemTypePicker: null});
	},

	beginMutation: () => {
		set((state) => ({mutationCount: state.mutationCount + 1}));
	},

	endMutation: () => {
		set((state) => ({mutationCount: Math.max(0, state.mutationCount - 1)}));
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
