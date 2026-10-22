// @vitest-environment happy-dom
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import type {Root} from "react-dom/client";

declare global {
	// React reads this to know act() wraps every update.
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const {act, createElement} = await import("react");
const {createRoot} = await import("react-dom/client");
const {QueryClient, QueryClientProvider} = await import("@tanstack/react-query");
const {LocationPickerHost} = await import("../src/client/components/location-picker-host.js");
const {useOutlineStore} = await import("../src/client/stores/outline.js");

/** Each `/api/search/locations` request in order, with a resolver to answer it later. */
let searches: {query: string; answer: (label: string) => void}[];

let root: Root | undefined;

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	searches = [];
	sessionStorage.clear();
	vi.stubGlobal(
		"fetch",
		vi.fn<typeof fetch>(async (input, init) => {
			const url = input instanceof Request ? input.url : input.toString();
			if (url === "/api/search/locations") {
				const {query} = JSON.parse(init?.body as string) as {query: string};
				return new Promise<Response>((resolve) => {
					searches.push({
						query,
						answer: (label) => {
							resolve(Response.json({results: [{id: `hit-${label}`, labelHtml: label, ancestors: []}]}));
						},
					});
				});
			}
			if (url === "/api/v1/stars") {
				return Response.json({stars: [], nodes: []});
			}
			return Response.json({});
		}),
	);
});

afterEach(() => {
	act(() => {
		useOutlineStore.getState().closeLocationPicker(undefined);
		root?.unmount();
	});
	vi.unstubAllGlobals();
});

async function flush(): Promise<void> {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

function type(input: HTMLInputElement, value: string): void {
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
		input.dispatchEvent(new Event("input", {bubbles: true}));
	});
}

describe("Location picker search requests", () => {
	it("requests on every keystroke without a debounce, and a stale reply never replaces the latest", async () => {
		const queryClient = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: 60_000}}});
		const container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
		act(() => {
			root?.render(createElement(QueryClientProvider, {client: queryClient}, createElement(LocationPickerHost)));
			void useOutlineStore
				.getState()
				.openLocationPicker({forItemId: "item", headerText: "Move To..."}, {x: 0, y: 0});
		});
		await flush();
		const input = document.querySelector<HTMLInputElement>('input[name="location-picker-query"]');
		if (input === null) {
			throw new Error("picker input missing");
		}

		type(input, "a");
		type(input, "ab");
		const requested = searches.map((search) => search.query);

		// The latest reply lands first, then the stale one arrives late.
		searches[1]?.answer("LatestHit");
		await flush();
		searches[0]?.answer("StaleHit");
		await flush();

		const text = document.body.textContent;
		expect({
			requested,
			latest: text.includes("LatestHit"),
			stale: text.includes("StaleHit"),
		}).toStrictEqual({requested: ["a", "ab"], latest: true, stale: false});
	});
});
