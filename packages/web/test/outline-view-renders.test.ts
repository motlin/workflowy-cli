// @vitest-environment happy-dom
import {afterAll, beforeAll, describe, expect, it, vi} from "vite-plus/test";
import type {Root} from "react-dom/client";
import type {NodeResponse} from "../src/node-types.js";

declare global {
	// React reads this to know act() wraps every update.
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

interface Fiber {
	type: unknown;
	flags: number;
	actualStartTime?: number;
	child: Fiber | null;
	sibling: Fiber | null;
}

/** Renders per component name, read from React's DevTools hook the way the Profiler does. */
const renders = new Map<string, number>();
let lastCommit = -1;
const PERFORMED_WORK = 1;

function componentName(type: unknown): string | undefined {
	if (typeof type === "function") {
		return type.name;
	}
	if (typeof type === "object" && type !== null && "type" in type && typeof type.type === "function") {
		return type.type.name;
	}
	return undefined;
}

function countRenders(start: Fiber | null): void {
	for (let fiber = start; fiber !== null; fiber = fiber.sibling) {
		const name = componentName(fiber.type);
		if (name !== undefined && (fiber.flags & PERFORMED_WORK) !== 0 && (fiber.actualStartTime ?? 0) > lastCommit) {
			renders.set(name, (renders.get(name) ?? 0) + 1);
		}
		countRenders(fiber.child);
	}
}

// React DOM looks for this global when it loads, so it is installed before the dynamic imports below.
Reflect.set(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
	renderers: new Map(),
	supportsFiber: true,
	isDisabled: false,
	inject: () => 1,
	onScheduleFiberRoot() {},
	onCommitFiberRoot(_id: number, root: {current: Fiber}) {
		countRenders(root.current.child);
		lastCommit = performance.now();
	},
	onCommitFiberUnmount() {},
	onPostCommitFiberRoot() {},
	checkDCE() {},
});

const {act, createElement} = await import("react");
const {createRoot} = await import("react-dom/client");
const {QueryClient, QueryClientProvider} = await import("@tanstack/react-query");
const {MemoryRouter} = await import("react-router-dom");
const {OutlineView} = await import("../src/client/app.js");
const {nodeKeys} = await import("../src/client/node-cache.js");
const {useOutlineStore} = await import("../src/client/stores/outline.js");

const alice: NodeResponse = {
	id: "alice",
	parent_id: null,
	name: "Alice",
	note: null,
	priority: 0,
	data: {layoutMode: null},
	completedAt: null,
	createdAt: 0,
	modifiedAt: 0,
	hasChildren: false,
};

const queryClient = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Number.POSITIVE_INFINITY}}});
let root: Root | undefined;

async function settle(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 20);
		});
	});
}

beforeAll(async () => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	vi.stubGlobal(
		"fetch",
		vi.fn<typeof fetch>(async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			// Only the root's children answer; every other endpoint is missing, so its query errors and stays empty.
			return Promise.resolve(
				url.includes("/children") ? Response.json([alice]) : Response.json({}, {status: 404}),
			);
		}),
	);
	queryClient.setQueryData(nodeKeys.children(null), [alice]);
	queryClient.setQueryData(nodeKeys.detail("alice"), alice);
	const container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	act(() => {
		root?.render(
			createElement(
				QueryClientProvider,
				{client: queryClient},
				createElement(MemoryRouter, null, createElement(OutlineView)),
			),
		);
	});
	await settle();
});

afterAll(() => {
	act(() => {
		root?.unmount();
	});
	vi.unstubAllGlobals();
});

describe("OutlineView render count", () => {
	it("does not re-render the page shell when editing moves to a row", async () => {
		renders.clear();
		act(() => {
			useOutlineStore.setState({editingId: "alice"});
		});
		await settle();
		expect(renders.get("OutlineView") ?? 0).toBe(0);
	});

	it("renders the outline rows it is given", () => {
		expect(document.querySelectorAll('[data-node-id="alice"]').length).toBeGreaterThan(0);
	});

	it("re-renders only the new row when a sibling joins an unchanged list", async () => {
		const bob: NodeResponse = {...alice, id: "bob", name: "Bob", priority: 1};
		renders.clear();
		act(() => {
			queryClient.setQueryData(nodeKeys.children(null), [
				queryClient.getQueryData<NodeResponse[]>(nodeKeys.children(null))?.[0] ?? alice,
				bob,
			]);
		});
		await settle();
		expect(renders.get("OutlineRow") ?? 0).toBe(1);
	});

	it("does not re-render the page shell when the edited row's text is saved", async () => {
		renders.clear();
		act(() => {
			queryClient.setQueryData(nodeKeys.detail("alice"), {...alice, name: "Alice!"});
		});
		await settle();
		expect(renders.get("OutlineView") ?? 0).toBe(0);
	});
});
