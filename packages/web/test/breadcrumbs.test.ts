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
vi.mock("../src/client/stores/outline.js", () => ({
	useOutlineStore: {getState: () => ({searchPanelOpen: false, toggleSearchPanel: () => {}})},
}));
vi.mock(import("../src/client/breadcrumb-layout.js"), async (importOriginal) => ({
	...(await importOriginal()),
	measureCrumbLabel: (label: string) => label.length * 7,
}));
vi.mock("../src/client/navigation.js", () => ({
	nodeUrl: (nodeId: string) => `/#/${nodeId.slice(-12)}`,
	useNodeNavigation: () => ({navigateToNode: () => {}}),
}));

vi.stubGlobal("window", {innerWidth: 1272});

const {Breadcrumbs, BreadcrumbOverflowMenu, handleCrumbClick} = await import("../src/client/components/breadcrumbs.js");

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
				`<a class="${crumbClass(false)}" href="/#/alice-uuid" data-item-id="alice-uuid">Alice</a>`,
				SEPARATOR,
				`<a class="${crumbClass(true)}" href="/#/bob-uuid" data-item-id="bob-uuid">Bob</a>`,
				"</div>",
			].join(""),
		);
	});

	it("labels an empty-named ancestor Untitled", () => {
		const html = render("empty-uuid", [{id: "empty-uuid", name: ""}]);
		expect(html.slice(html.lastIndexOf("<a "))).toBe(
			`<a class="${crumbClass(true)}" href="/#/empty-uuid" data-item-id="empty-uuid">Untitled</a></div>`,
		);
	});

	it("labels a date-node ancestor with its formatted date", () => {
		const html = render("day-uuid", [
			{id: "day-uuid", name: '<time startYear="2020" startMonth="3" startDay="5">Thu, Mar 5, 2020</time>'},
		]);
		expect(html.slice(html.lastIndexOf("<a "))).toBe(
			`<a class="${crumbClass(true)}" href="/#/day-uuid" data-item-id="day-uuid">2020-03-05 Thu</a></div>`,
		);
	});
});

function longName(name: string): string {
	return name.padEnd(40, ".");
}

const DEEP_ANCESTORS: Ancestor[] = ["Sandbox", "Alpha", "Bravo", "Charlie", "Delta", "Echo"].map((name) => ({
	id: `${name.toLowerCase()}-uuid`,
	name: longName(name),
}));

/** Top-level tags of the container, in order. */
function childTags(html: string): string[] {
	const inner = html.slice(CONTAINER_OPEN.length, -"</div>".length);
	const tags: string[] = [];
	let depth = 0;
	for (const match of inner.matchAll(/<(\/?)([a-z]+)[^>]*?(\/?)>/gu)) {
		const [, closing, tag, selfClosing] = match;
		if (closing === "/") {
			depth--;
		} else if (selfClosing !== "/") {
			if (depth === 0) {
				tags.push(tag);
			}
			depth++;
		}
	}
	return tags;
}

describe("Breadcrumbs overflow", () => {
	it("truncates and collapses a deep trail into one ellipsis menu at 675px", () => {
		vi.stubGlobal("window", {innerWidth: 675});
		const html = render("echo-uuid", DEEP_ANCESTORS);
		vi.stubGlobal("window", {innerWidth: 1272});
		expect({
			tags: childTags(html),
			menus: html.split('<div tabindex="0" class="relative outline-none menu ">').length - 1,
			maxWidths: [...html.matchAll(/style="max-width:(\d+)px" href="[^"]*" data-item-id="([^"]+)"/gu)].map(
				([, width, id]) => [id, Number(width)],
			),
			ellipsis: html.includes(
				'<div tabindex="0" class="relative outline-none menu "><div><div role="button" tabindex="0" class="iconButton md shape-circle"><svg aria-hidden="true" focusable="false" data-prefix="fal" data-icon="ellipsis" class="svg-inline--fa fa-ellipsis fa-1x "',
			),
		}).toStrictEqual({
			tags: ["a", "svg", "a", "svg", "a", "svg", "div", "svg", "a", "svg", "a"],
			menus: 1,
			maxWidths: [
				["sandbox-uuid", 118],
				["alpha-uuid", 118],
				["delta-uuid", 118],
				["echo-uuid", 118],
			],
			ellipsis: true,
		});
	});

	it("only truncates, without an ellipsis menu, when the window is wide enough", () => {
		const html = render("echo-uuid", DEEP_ANCESTORS);
		expect({tags: childTags(html), menu: html.includes("outline-none menu")}).toStrictEqual({
			tags: ["a", "svg", "a", "svg", "a", "svg", "a", "svg", "a", "svg", "a", "svg", "a"],
			menu: false,
		});
	});

	it("renders the collapsed crumbs as a separator-free vertical list", () => {
		const html = renderToStaticMarkup(
			createElement(BreadcrumbOverflowMenu, {
				items: [
					{id: "bravo-uuid", label: longName("Bravo"), group: 1, isZoomed: false, truncateWidth: null},
					{id: "charlie-uuid", label: longName("Charlie"), group: 1, isZoomed: false, truncateWidth: null},
				],
				crumbs: new Map([
					["bravo-uuid", {id: "bravo-uuid", isRoot: false, name: longName("Bravo")}],
					["charlie-uuid", {id: "charlie-uuid", isRoot: false, name: longName("Charlie")}],
				]),
				currentId: "echo-uuid",
				maxWidth: 822,
				onNavigate: () => {},
			}),
		);
		expect(html).toBe(
			[
				'<div class="flex flex-col items-stretch gap-m px-m breadcrumb-overflow-menu" style="max-width:822px">',
				`<div><a class="${crumbClass(false)}" href="/#/bravo-uuid" data-item-id="bravo-uuid">${longName("Bravo")}</a></div>`,
				`<div><a class="${crumbClass(false)}" href="/#/charlie-uuid" data-item-id="charlie-uuid">${longName("Charlie")}</a></div>`,
				"</div>",
			].join(""),
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
