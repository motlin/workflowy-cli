// @vitest-environment happy-dom
import {afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";
import type {Root} from "react-dom/client";

declare global {
	// React reads this to know act() wraps every update.
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const {useSyncExternalStore} = await import("react");

interface StoreState {
	searchInput: string;
	searchFocused: boolean;
	setSearchInput: (value: string) => void;
	setSearchFocused: (focused: boolean) => void;
	commitSearch: (query: string) => void;
}

const listeners = new Set<() => void>();
let state: StoreState = {
	searchInput: "",
	searchFocused: true,
	setSearchInput: (value) => {
		setState({searchInput: value});
	},
	setSearchFocused: () => {},
	commitSearch: (query) => {
		setState({searchInput: query});
	},
};

function setState(patch: Partial<StoreState>): void {
	state = {...state, ...patch};
	for (const listener of listeners) {
		listener();
	}
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

vi.mock("../src/client/stores/outline.js", () => ({
	useOutlineStore: Object.assign(
		(selector: (s: StoreState) => unknown) => selector(useSyncExternalStore(subscribe, () => state)),
		{getState: () => state},
	),
}));
vi.mock("../src/client/hooks/use-stable-navigate.js", () => ({useStableNavigate: () => () => {}}));
vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({invalidateQueries: () => {}}),
	useQuery: () => ({data: undefined}),
}));
vi.mock("../src/client/hooks/use-breakpoint.js", () => ({useBreakpoint: () => true}));

const {act, createElement} = await import("react");
const {createRoot} = await import("react-dom/client");
const {SearchBox} = await import("../src/client/components/search-box.js");

let root: Root | undefined;

beforeAll(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
	act(() => {
		root?.unmount();
	});
	root = undefined;
	document.body.innerHTML = "";
	state = {...state, searchInput: ""};
});

function mount(): HTMLInputElement {
	const container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root?.render(createElement(SearchBox));
	});
	return document.querySelector<HTMLInputElement>("#srch-input")!;
}

function press(input: HTMLInputElement, key: string): void {
	act(() => {
		input.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true}));
	});
}

function chips(): HTMLElement[] {
	return [...document.querySelectorAll<HTMLElement>("a.menuItem")];
}

// No tags in the zoom, so the tabs are globe, mentions, dates, ...
function selectDatesTab(input: HTMLInputElement): void {
	for (const key of ["ArrowDown", "ArrowRight", "ArrowRight"]) {
		press(input, key);
	}
}

describe("search helper chips", () => {
	it("makes the hovered chip the only active one and switches to the mouse classes", () => {
		const input = mount();
		selectDatesTab(input);
		const keyboardMode = chips().map((chip) => chip.className.includes("canHover"));

		act(() => {
			chips()[4]?.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
		});

		expect({
			keyboardMode: keyboardMode.some(Boolean),
			active: chips().flatMap((chip, index) => (chip.className.endsWith("active canHover") ? [index] : [])),
			allHover: chips().every((chip) => chip.className.includes(" hover:bg-secondary ")),
		}).toStrictEqual({keyboardMode: false, active: [4], allHover: true});
	});

	it("keeps the tab open after a chip click and resets it on a click into the input", () => {
		const input = mount();
		selectDatesTab(input);
		const today = chips().find((chip) => chip.textContent === "today");

		act(() => {
			today?.dispatchEvent(new MouseEvent("mousedown", {bubbles: true}));
			today?.dispatchEvent(new MouseEvent("click", {bubbles: true}));
		});
		const afterChip = {query: state.searchInput, chips: chips().length};
		act(() => {
			input.dispatchEvent(new MouseEvent("click", {bubbles: true}));
		});

		expect({afterChip, afterInput: chips().length}).toStrictEqual({
			afterChip: {query: "today ", chips: 13},
			afterInput: 0,
		});
	});
});
