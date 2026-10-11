import {beforeAll, describe, expect, it, vi} from "vite-plus/test";

vi.stubGlobal("localStorage", {getItem: () => null, setItem: () => {}});
vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: () => {}}));
vi.stubGlobal("document", {documentElement: {dataset: {}}});
vi.stubGlobal("addEventListener", () => {});

const {useOutlineStore} = await import("../src/client/stores/outline.js");

function searchState() {
	const {searchPanelOpen, searchInitialQuery, searchPanelSession} = useOutlineStore.getState();
	return {searchPanelOpen, searchInitialQuery, searchPanelSession};
}

describe("search panel sessions", () => {
	beforeAll(() => {
		useOutlineStore.setState({searchPanelOpen: false, searchInitialQuery: null, searchPanelSession: 0});
	});

	it("starts a fresh session for every request, so a repeated query still resets the open panel", () => {
		const {openSearchWithQuery, toggleSearchPanel} = useOutlineStore.getState();
		openSearchWithQuery("#alice");
		const first = searchState();
		openSearchWithQuery("#alice");
		const second = searchState();
		toggleSearchPanel();
		toggleSearchPanel();
		const reopened = searchState();
		expect({first, second, reopened}).toStrictEqual({
			first: {searchPanelOpen: true, searchInitialQuery: "#alice", searchPanelSession: 1},
			second: {searchPanelOpen: true, searchInitialQuery: "#alice", searchPanelSession: 2},
			reopened: {searchPanelOpen: true, searchInitialQuery: null, searchPanelSession: 4},
		});
	});
});
