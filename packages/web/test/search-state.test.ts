import {beforeEach, describe, expect, it, vi} from "vite-plus/test";

vi.stubGlobal("localStorage", {getItem: () => null, setItem: () => {}});
vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: () => {}}));
vi.stubGlobal("document", {documentElement: {dataset: {}}, body: {classList: {toggle: () => true}}});
vi.stubGlobal("addEventListener", () => {});

const {useOutlineStore} = await import("../src/client/stores/outline.js");
const {initialNavState} = await import("../src/client/nav-stack.js");

const SANDBOX_ID = "7aed376b-80c8-42c5-8065-ab03ee6d2ae0";

function searchState() {
	const {searchQuery, searchInput, searchRun, searchCreatedIds, searchExpansion} = useOutlineStore.getState();
	return {searchQuery, searchInput, searchRun, searchCreatedIds, searchExpansion};
}

describe("committed search state", () => {
	beforeEach(() => {
		useOutlineStore.setState({
			nav: initialNavState,
			zoomedNodeId: SANDBOX_ID,
			urlSearchQuery: null,
			searchQuery: "",
			searchInput: "",
			searchRun: 0,
			searchCreatedIds: new Set(),
			searchExpansion: new Map(),
		});
	});

	it("commitSearch pushes the zoomed node's URL with ?q=", () => {
		const navigate = vi.fn<(to: string) => void>();
		useOutlineStore.getState().commitSearch("apple", navigate);
		expect(navigate.mock.calls).toStrictEqual([["/#/ab03ee6d2ae0?q=apple"]]);
	});

	it("commitSearch with an empty query pushes the bare node URL", () => {
		useOutlineStore.getState().setUrlSearchQuery("apple");
		const navigate = vi.fn<(to: string) => void>();
		useOutlineStore.getState().commitSearch("", navigate);
		expect(navigate.mock.calls).toStrictEqual([["/#/ab03ee6d2ae0"]]);
	});

	it("cancelSearch clears the input and pushes the bare node URL", () => {
		useOutlineStore.getState().setUrlSearchQuery("apple");
		useOutlineStore.getState().setSearchInput("apple pie");
		const navigate = vi.fn<(to: string) => void>();
		useOutlineStore.getState().cancelSearch(navigate);
		expect({urls: navigate.mock.calls, searchInput: useOutlineStore.getState().searchInput}).toStrictEqual({
			urls: [["/#/ab03ee6d2ae0"]],
			searchInput: "",
		});
	});

	it("a URL query change sets the committed query and the input text", () => {
		useOutlineStore.getState().setUrlSearchQuery("apple");
		const applied = searchState();
		useOutlineStore.getState().setUrlSearchQuery(null);
		expect({applied, cleared: searchState()}).toStrictEqual({
			applied: {
				searchQuery: "apple",
				searchInput: "apple",
				searchRun: 0,
				searchCreatedIds: new Set(),
				searchExpansion: new Map(),
			},
			cleared: {
				searchQuery: "",
				searchInput: "",
				searchRun: 0,
				searchCreatedIds: new Set(),
				searchExpansion: new Map(),
			},
		});
	});

	it("zooming to another node clears search expansion and created ids", () => {
		useOutlineStore.setState({searchCreatedIds: new Set(["n1"]), searchExpansion: new Map([["n2", true]])});
		useOutlineStore.getState().zoom("other-node");
		const {searchCreatedIds, searchExpansion} = useOutlineStore.getState();
		expect({searchCreatedIds, searchExpansion}).toStrictEqual({
			searchCreatedIds: new Set(),
			searchExpansion: new Map(),
		});
	});

	it("re-zooming the same node keeps search expansion and created ids", () => {
		useOutlineStore.setState({searchCreatedIds: new Set(["n1"]), searchExpansion: new Map([["n2", true]])});
		useOutlineStore.getState().zoom(SANDBOX_ID);
		const {searchCreatedIds, searchExpansion} = useOutlineStore.getState();
		expect({searchCreatedIds, searchExpansion}).toStrictEqual({
			searchCreatedIds: new Set(["n1"]),
			searchExpansion: new Map([["n2", true]]),
		});
	});

	it("a new committed query clears search expansion and created ids", () => {
		useOutlineStore.setState({searchCreatedIds: new Set(["n1"]), searchExpansion: new Map([["n2", true]])});
		useOutlineStore.getState().setUrlSearchQuery("pear");
		const {searchCreatedIds, searchExpansion} = useOutlineStore.getState();
		expect({searchCreatedIds, searchExpansion}).toStrictEqual({
			searchCreatedIds: new Set(),
			searchExpansion: new Map(),
		});
	});

	it("committing the same query re-runs it without navigating", () => {
		useOutlineStore.getState().setUrlSearchQuery("apple");
		useOutlineStore.setState({searchCreatedIds: new Set(["n1"])});
		const navigate = vi.fn<(to: string) => void>();
		useOutlineStore.getState().commitSearch("apple", navigate);
		useOutlineStore.getState().commitSearch("apple", navigate);
		expect({urls: navigate.mock.calls, ...searchState()}).toStrictEqual({
			urls: [],
			searchQuery: "apple",
			searchInput: "apple",
			searchRun: 2,
			searchCreatedIds: new Set(),
			searchExpansion: new Map(),
		});
	});
});
