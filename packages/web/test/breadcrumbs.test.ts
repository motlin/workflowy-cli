import {describe, expect, it, vi} from "vite-plus/test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";

interface Ancestor {
	id: string;
	name: string | null;
}

const ancestorsState: {data: Ancestor[] | undefined; isLoading: boolean} = {data: undefined, isLoading: false};

vi.mock("../src/client/hooks/use-nodes.js", () => ({
	useAncestors: () => ancestorsState,
}));
vi.mock("../src/client/navigation.js", () => ({
	nodeRoute: (nodeId: string) => `/node/${nodeId}`,
	useNodeNavigation: () => ({navigateToNode: () => {}}),
}));

const {Breadcrumbs, handleCrumbClick} = await import("../src/client/components/breadcrumbs.js");

const CRUMB_CLASS =
	"breadcrumb-item flex-shrink-0 whitespace-nowrap overflow-hidden truncate {state}\n    data-hj-suppress hover:pointer-fine:opacity-100 hover:pointer-fine:underline cursor-pointer";

const HOUSE_SVG =
	'<svg aria-hidden="true" focusable="false" data-prefix="fal" data-icon="house" class="svg-inline--fa fa-house fa-lg " role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><path fill="currentColor"></path></svg>';

const SEPARATOR =
	'<svg width="5" height="8" viewBox="0 0 5 8" fill="none" class="flex-shrink-0"><path d="M0 0 L4 4 L0 8" stroke="currentColor" stroke-linecap="round"></path></svg>';

const CONTAINER_OPEN =
	'<div class="breadcrumbs grow shrink min-w-0 flex gap-m items-center text-s leading-base overflow-hidden">';

function crumbClass(current: boolean): string {
	return CRUMB_CLASS.replace("{state}", current ? "current opacity-100" : "opacity-70");
}

function render(nodeId: string | null, ancestors: Ancestor[] | undefined, isLoading = false): string {
	ancestorsState.data = ancestors;
	ancestorsState.isLoading = isLoading;
	// Strip FontAwesome path data; keep the separator chevron's path.
	return renderToStaticMarkup(createElement(Breadcrumbs, {nodeId})).replaceAll(/ d="([^"]*)"/gu, (match, d) =>
		d === "M0 0 L4 4 L0 8" ? match : "",
	);
}

const ROOT_MARKUP = `${CONTAINER_OPEN}<div class="${crumbClass(true)}"><div role="button" tabindex="-1" aria-disabled="true" data-handbook="nav.home" class="homeButton disabled iconButton lg shape-circle disabled">${HOUSE_SVG}</div></div></div>`;

describe("Breadcrumbs markup", () => {
	it("renders a disabled current Home crumb at the root", () => {
		expect(render(null, undefined)).toBe(ROOT_MARKUP);
	});

	it("renders the root shape while ancestors load", () => {
		expect(render("bob-uuid", undefined, true)).toBe(ROOT_MARKUP);
	});

	it("renders flat anchors with a separator after every non-current crumb", () => {
		const html = render("bob-uuid", [
			{id: "alice-uuid", name: "Alice"},
			{id: "bob-uuid", name: "<b>Bob</b>"},
		]);
		expect(html).toBe(
			[
				CONTAINER_OPEN,
				`<a class="${crumbClass(false)}" href="/" data-item-id="None"><div role="button" tabindex="0" data-handbook="nav.home" class="homeButton  iconButton lg shape-circle">${HOUSE_SVG}</div></a>`,
				SEPARATOR,
				`<a class="${crumbClass(false)}" href="/node/alice-uuid" data-item-id="alice-uuid">Alice</a>`,
				SEPARATOR,
				`<a class="${crumbClass(true)}" href="/node/bob-uuid" data-item-id="bob-uuid">Bob</a>`,
				"</div>",
			].join(""),
		);
	});

	it("labels an empty-named ancestor Untitled", () => {
		const html = render("empty-uuid", [{id: "empty-uuid", name: ""}]);
		expect(html.slice(html.lastIndexOf("<a "))).toBe(
			`<a class="${crumbClass(true)}" href="/node/empty-uuid" data-item-id="empty-uuid">Untitled</a></div>`,
		);
	});
});

function clickEvent(
	overrides: Partial<{altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; button: number}>,
) {
	return {
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		button: 0,
		...overrides,
		preventDefault: vi.fn<() => void>(),
	};
}

describe("handleCrumbClick", () => {
	it("leaves a meta-click to the browser", () => {
		const event = clickEvent({metaKey: true});
		const navigateToNode = vi.fn<(nodeId: string | null) => void>();
		handleCrumbClick(event, {id: "alice-uuid", isRoot: false}, {navigateToNode});
		expect({preventDefault: event.preventDefault.mock.calls, navigate: navigateToNode.mock.calls}).toStrictEqual({
			preventDefault: [],
			navigate: [],
		});
	});

	it("leaves a middle-click to the browser", () => {
		const event = clickEvent({button: 1});
		const navigateToNode = vi.fn<(nodeId: string | null) => void>();
		handleCrumbClick(event, {id: "alice-uuid", isRoot: false}, {navigateToNode});
		expect({preventDefault: event.preventDefault.mock.calls, navigate: navigateToNode.mock.calls}).toStrictEqual({
			preventDefault: [],
			navigate: [],
		});
	});

	it("navigates in-app on a plain click", () => {
		const event = clickEvent({});
		const navigateToNode = vi.fn<(nodeId: string | null) => void>();
		handleCrumbClick(event, {id: "alice-uuid", isRoot: false}, {navigateToNode});
		expect({preventDefault: event.preventDefault.mock.calls, navigate: navigateToNode.mock.calls}).toStrictEqual({
			preventDefault: [[]],
			navigate: [["alice-uuid"]],
		});
	});

	it("navigates to the root on a plain Home click", () => {
		const event = clickEvent({});
		const navigateToNode = vi.fn<(nodeId: string | null) => void>();
		handleCrumbClick(event, {id: "None", isRoot: true}, {navigateToNode});
		expect(navigateToNode.mock.calls).toStrictEqual([[null]]);
	});
});
