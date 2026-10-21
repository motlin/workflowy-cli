import {describe, expect, it, vi} from "vite-plus/test";
import {QueryClient} from "@tanstack/react-query";

vi.stubGlobal("localStorage", {getItem: () => null, setItem: () => {}});
vi.stubGlobal("innerWidth", 1272);
vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: () => {}}));
vi.stubGlobal("document", {documentElement: {dataset: {}}, body: {classList: {toggle: () => true}}});
vi.stubGlobal("addEventListener", () => {});

const {treeSearchOptions} = await import("../src/client/hooks/use-tree-search.js");

const search = {zoomedNodeId: null, searchRun: 0, searchSession: 3};

describe("treeSearchOptions", () => {
	it("scans the cache for the session's last result only while a search is committed", () => {
		const queryClient = new QueryClient();

		const cleared = treeSearchOptions(queryClient, {...search, searchQuery: ""});
		const committed = treeSearchOptions(queryClient, {...search, searchQuery: "e"});

		expect({
			cleared: {enabled: cleared.enabled, placeholderData: cleared.placeholderData},
			committed: {enabled: committed.enabled, placeholderData: typeof committed.placeholderData},
		}).toStrictEqual({
			cleared: {enabled: false, placeholderData: undefined},
			committed: {enabled: true, placeholderData: "function"},
		});
	});
});
