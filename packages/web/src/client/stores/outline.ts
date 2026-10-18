import {create} from "zustand";
import {z} from "zod";
import {themeBodyClass} from "../theme-body-class.js";
import {initialNavState, navReducer} from "../nav-stack.js";
import type {NavAction, NavState} from "../nav-stack.js";

const StringArraySchema = z.array(z.string());

const SHOW_COMPLETED_STORAGE_KEY = "workflowy-show-completed";
const STARRED_PAGES_STORAGE_KEY = "workflowy-starred-pages";
const THEME_STORAGE_KEY = "workflowy-theme";
const SAVED_SEARCHES_STORAGE_KEY = "workflowy-saved-searches";
const RECENT_SEARCHES_STORAGE_KEY = "workflowy-recent-searches";
const RECENT_SEARCHES_LIMIT = 10;

export type Theme = "light" | "dark" | "system";

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

function getInitialShowCompleted(): boolean {
	const stored = localStorage.getItem(SHOW_COMPLETED_STORAGE_KEY);
	return stored === null ? true : stored === "true";
}

function getInitialStarredPages(): Set<string> {
	const stored = localStorage.getItem(STARRED_PAGES_STORAGE_KEY);
	if (stored === null) {
		return new Set();
	}
	const result = StringArraySchema.safeParse(JSON.parse(stored));
	return new Set(result.success ? result.data : []);
}

function getInitialSavedSearches(): string[] {
	const stored = localStorage.getItem(SAVED_SEARCHES_STORAGE_KEY);
	if (stored === null) {
		return [];
	}
	const result = StringArraySchema.safeParse(JSON.parse(stored));
	return result.success ? result.data : [];
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

interface ClickPosition {
	x: number;
	y: number;
}

interface SearchReturn {
	nodeId: string;
	caretOffset: number;
}

interface OutlineState {
	zoomedNodeId: string | null;
	expandedIds: Set<string>;
	editingId: string | null;
	editingClickPosition: ClickPosition | null;
	/** Text offset to place the caret at when editing resumes after dismissing search. */
	editingCaretOffset: number | null;
	editingNoteId: string | null;
	/** Set while a structural shortcut moves the edited node, so the blur from re-rendering keeps editing. */
	editingHeld: boolean;
	/** The most recently edited node; panels that follow the user's place outlive the edit's blur. */
	lastEditedId: string | null;
	showCompleted: boolean;
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
	starredPages: Set<string>;
	savedSearches: string[];
	recentSearches: string[];
	relatedNodesPanelOpen: boolean;
	moveAssistantOpen: boolean;
	moveAssistantContext: MoveAssistantContext | null;
	exportDialogOpen: boolean;
	exportContext: ExportContext | null;
	presentationOpen: boolean;
	presentationContext: PresentationContext | null;
	settingsOpen: boolean;
	theme: Theme;
	isOnline: boolean;
	errorNotifications: ErrorNotification[];
	isMutating: boolean;
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
	expandAll: (ids: string[]) => void;
	collapseAll: () => void;
	collapseDescendants: (ids: string[]) => void;
	startEditing: (id: string, clickPosition?: ClickPosition) => void;
	stopEditing: () => void;
	startEditingNote: (id: string) => void;
	stopEditingNote: () => void;
	/** Edit `id` with the caret `caretOffset` text characters in (clamped to the end). */
	resumeEditing: (id: string, caretOffset: number) => void;
	holdEditing: (caretOffset: number) => void;
	releaseEditing: () => void;
	toggleCompleted: () => void;
	toggleLeftBar: () => void;
	openLeftBarDrawer: () => void;
	closeLeftBarDrawer: () => void;
	setLeftBarWidth: (width: number) => void;
	setLeftBarSectionExpanded: (key: string, value: boolean) => void;
	setLeftBarHovered: (hovered: boolean) => void;
	/** Horizontal space the pinned bar takes from the page; 0 for the drawer. */
	leftBarOffset: () => number;
	toggleRightSidebar: () => void;
	toggleStarPage: (id: string) => void;
	isPageStarred: (id: string) => boolean;
	saveSearch: (query: string) => void;
	removeSavedSearch: (query: string) => void;
	getSavedSearches: () => string[];
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
	openSettings: () => void;
	closeSettings: () => void;
	setTheme: (theme: Theme) => void;
	setOnline: (isOnline: boolean) => void;
	addErrorNotification: (message: string, type?: "error" | "warning" | "info", retryAction?: () => void) => string;
	removeErrorNotification: (id: string) => void;
	clearAllErrorNotifications: () => void;
	setMutating: (isMutating: boolean) => void;
}

type OutlineStore = OutlineActions & OutlineState;

/**
 * Whether a blur of `nodeId`'s editor should commit its text and stop editing.
 * Not when a structural shortcut holds editing across the re-render, and not
 * when editing already moved to another node (the mover committed the text).
 */
export function shouldCommitOnBlur(state: Pick<OutlineState, "editingId" | "editingHeld">, nodeId: string): boolean {
	return state.editingId === nodeId && !state.editingHeld;
}

export const useOutlineStore = create<OutlineStore>((set, get) => ({
	zoomedNodeId: null,
	expandedIds: new Set<string>(),
	editingId: null,
	editingClickPosition: null,
	editingCaretOffset: null,
	editingNoteId: null,
	editingHeld: false,
	lastEditedId: null,
	showCompleted: getInitialShowCompleted(),
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
	starredPages: getInitialStarredPages(),
	savedSearches: getInitialSavedSearches(),
	recentSearches: getInitialRecentSearches(),
	relatedNodesPanelOpen: false,
	moveAssistantOpen: false,
	moveAssistantContext: null,
	exportDialogOpen: false,
	exportContext: null,
	presentationOpen: false,
	presentationContext: null,
	settingsOpen: false,
	theme: getInitialTheme(),
	isOnline: typeof navigator === "undefined" ? true : navigator.onLine,
	errorNotifications: [],
	isMutating: false,
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
		set((state) => {
			const newExpandedIds = new Set(state.expandedIds);
			if (newExpandedIds.has(id)) {
				newExpandedIds.delete(id);
			} else {
				newExpandedIds.add(id);
			}
			return {expandedIds: newExpandedIds};
		});
	},

	expand: (id) => {
		set((state) => {
			const newExpandedIds = new Set([...state.expandedIds, id]);
			return {expandedIds: newExpandedIds};
		});
	},

	collapse: (id) => {
		set((state) => {
			const newExpandedIds = new Set(state.expandedIds);
			newExpandedIds.delete(id);
			return {expandedIds: newExpandedIds};
		});
	},

	expandAll: (ids) => {
		set((state) => {
			const newExpandedIds = new Set(state.expandedIds);
			for (const id of ids) {
				newExpandedIds.add(id);
			}
			return {expandedIds: newExpandedIds};
		});
	},

	collapseAll: () => {
		set({expandedIds: new Set<string>()});
	},

	collapseDescendants: (ids) => {
		set((state) => {
			const newExpandedIds = new Set(state.expandedIds);
			for (const id of ids) {
				newExpandedIds.delete(id);
			}
			return {expandedIds: newExpandedIds};
		});
	},

	startEditing: (id, clickPosition) => {
		set({editingId: id, editingClickPosition: clickPosition ?? null, editingCaretOffset: null, lastEditedId: id});
	},

	stopEditing: () => {
		set({editingId: null, editingClickPosition: null, editingCaretOffset: null});
	},

	startEditingNote: (id) => {
		set({editingNoteId: id, lastEditedId: id});
	},

	stopEditingNote: () => {
		set({editingNoteId: null});
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

	toggleCompleted: () => {
		set((state) => {
			const newShowCompleted = !state.showCompleted;
			localStorage.setItem(SHOW_COMPLETED_STORAGE_KEY, String(newShowCompleted));
			return {showCompleted: newShowCompleted};
		});
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

	toggleStarPage: (id) => {
		set((state) => {
			const newStarredPages = new Set(state.starredPages);
			if (newStarredPages.has(id)) {
				newStarredPages.delete(id);
			} else {
				newStarredPages.add(id);
			}
			localStorage.setItem(STARRED_PAGES_STORAGE_KEY, JSON.stringify([...newStarredPages]));
			return {starredPages: newStarredPages};
		});
	},

	isPageStarred: (id) => get().starredPages.has(id),

	saveSearch: (query) => {
		set((state) => {
			const trimmedQuery = query.trim();
			if (!trimmedQuery || state.savedSearches.includes(trimmedQuery)) {
				return state;
			}
			const newSavedSearches = [trimmedQuery, ...state.savedSearches];
			localStorage.setItem(SAVED_SEARCHES_STORAGE_KEY, JSON.stringify(newSavedSearches));
			return {savedSearches: newSavedSearches};
		});
	},

	removeSavedSearch: (query) => {
		set((state) => {
			const newSavedSearches = state.savedSearches.filter((s) => s !== query);
			localStorage.setItem(SAVED_SEARCHES_STORAGE_KEY, JSON.stringify(newSavedSearches));
			return {savedSearches: newSavedSearches};
		});
	},

	getSavedSearches: () => get().savedSearches,

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

	openSettings: () => {
		set({settingsOpen: true});
	},

	closeSettings: () => {
		set({settingsOpen: false});
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

	setMutating: (isMutating) => {
		set({isMutating});
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
