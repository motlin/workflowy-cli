import {describe, expect, it, vi} from "vite-plus/test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import type {LeftBarMode} from "../src/client/stores/outline.js";

const storeState = {
	leftBarMode: "drawerClosed" as LeftBarMode,
	leftBarWidth: 296,
	leftBarHovered: false,
	toggleLeftBar: () => {},
	closeLeftBarDrawer: () => {},
	setLeftBarHovered: () => {},
	setLeftBarWidth: () => {},
	savedSearches: [] as string[],
	starredPages: new Set<string>(),
	zoomedNodeId: null as string | null,
	startEditing: vi.fn<(id: string) => void>(),
	toggleStarPage: () => {},
	openSearchWithQuery: () => {},
	removeSavedSearch: () => {},
	leftBarSectionExpansions: {} as Record<string, boolean>,
	setLeftBarSectionExpanded: vi.fn<(key: string, value: boolean) => void>(),
};

vi.mock("../src/client/stores/outline.js", () => ({
	useOutlineStore: (selector?: (state: typeof storeState) => unknown) =>
		selector === undefined ? storeState : selector(storeState),
}));
const navigateMock = vi.fn<(path: string) => void>();
const mutateMock = vi.fn<(payload: unknown, options?: {onSuccess?: (node: {id: string}) => void}) => void>();
let rootChildren: {id: string}[] = [];

vi.mock("react-router-dom", () => ({useNavigate: () => navigateMock}));
vi.mock("../src/client/hooks/use-nodes.js", () => ({
	useChildren: () => ({data: rootChildren}),
	useCreateNode: () => ({mutate: mutateMock}),
	useNode: () => ({data: undefined}),
}));

const {HomeSectionName, LeftBar, LeftBarSection, NewNodeButton, applyBodyOffset, resizeWidth} =
	await import("../src/client/components/left-sidebar.js");
const {TRIANGLE_PATH} = await import("../src/client/components/fa-icons.js");

function render(mode: LeftBarMode, hovered = false): string {
	storeState.leftBarMode = mode;
	storeState.leftBarHovered = hovered;
	return renderToStaticMarkup(createElement(LeftBar));
}

function openTag(html: string, classPrefix: string): string {
	const classAt = html.indexOf(` class="${classPrefix}`);
	if (classAt === -1) {
		throw new Error(`no element with class prefix ${classPrefix}`);
	}
	return html.slice(html.lastIndexOf("<div", classAt), html.indexOf(">", classAt) + 1);
}

const SHADOW = "absolute top-0 left-0 bottom-0 right-0 transition-[opacity]";
const SCROLLER = "absolute top-0 left-0 right-0 bottom-0 mr-1";
const PIN = "absolute top-m right-m";

describe("LeftBar shell", () => {
	it("renders the closed drawer offscreen below the header", () => {
		const html = render("drawerClosed");
		expect({
			outer: openTag(html, "fixed left-0"),
			inner: openTag(html, "wf-left-bar"),
			shadow: openTag(html, SHADOW),
			scroller: openTag(html, SCROLLER),
			pin: openTag(html, PIN),
			hoverTarget: html.includes("leftBarTopHiddenHoverTarget"),
			resizeTarget: html.includes("resizeTarget"),
		}).toStrictEqual({
			outer: '<div class="fixed left-0 bottom-0 transition-[top] duration-250 ease-base leftBar" style="z-index:200;top:49px;width:var(--safe-area-inset-right)">',
			inner: '<div class="wf-left-bar absolute z-[2] box-border bg-primary  text-tertiary" style="top:12px;bottom:12px;left:-296px;width:296px;border-radius:0 6px 6px 0;transition:left 0.25s, bottom 0.25s">',
			shadow: `<div class="${SHADOW} duration-250 ease-base" style="border-radius:0 6px 6px 0;box-shadow:var(--wf-box-shadow-m);opacity:0">`,
			scroller: `<div class="${SCROLLER} pt-3xl pb-m overflow-x-hidden scroller vertical-scrollable-container" style="padding-left:var(--safe-area-inset-left);overflow-y:hidden;scrollbar-gutter:stable">`,
			pin: `<div role="button" tabindex="0" style="transform:rotate(135deg)" class="${PIN} transition-[transform] duration-250 ease-base iconButton lg shape-circle">`,
			hoverTarget: true,
			resizeTarget: false,
		});
	});

	it("lets a hovered closed drawer scroll", () => {
		expect(openTag(render("drawerClosed", true), SCROLLER)).toContain("overflow-y:auto");
	});

	it("renders the open drawer onscreen with its shadow", () => {
		const html = render("drawerOpen");
		expect({
			outer: openTag(html, "fixed left-0"),
			inner: openTag(html, "wf-left-bar"),
			shadow: openTag(html, SHADOW),
			scroller: openTag(html, SCROLLER),
			pin: openTag(html, PIN),
			hoverTarget: html.includes("leftBarTopHiddenHoverTarget"),
			resizeTarget: html.includes("resizeTarget"),
		}).toStrictEqual({
			outer: '<div class="fixed left-0 bottom-0 transition-[top] duration-250 ease-base leftBar" style="z-index:200;top:49px;width:var(--safe-area-inset-right)">',
			inner: '<div class="wf-left-bar absolute z-[2] box-border bg-primary  text-tertiary" style="top:12px;bottom:12px;left:0;width:296px;border-radius:0 6px 6px 0;transition:left 0.25s, bottom 0.25s">',
			shadow: `<div class="${SHADOW} duration-250 ease-base" style="border-radius:0 6px 6px 0;box-shadow:var(--wf-box-shadow-m);opacity:1">`,
			scroller: `<div class="${SCROLLER} pt-3xl pb-m overflow-x-hidden scroller vertical-scrollable-container" style="padding-left:var(--safe-area-inset-left);overflow-y:auto;scrollbar-gutter:stable">`,
			pin: `<div role="button" tabindex="0" style="transform:rotate(135deg)" class="${PIN} transition-[transform] duration-250 ease-base iconButton lg shape-circle">`,
			hoverTarget: true,
			resizeTarget: false,
		});
	});

	it("renders the pinned bar full height with edge and resize target", () => {
		const html = render("alwaysOpen");
		expect({
			outer: openTag(html, "fixed left-0"),
			inner: openTag(html, "wf-left-bar"),
			shadow: openTag(html, SHADOW),
			edge: openTag(html, "absolute top-0 bottom-0 -right-px"),
			resize: openTag(html, "resizeTarget"),
			pin: openTag(html, PIN),
			hoverTarget: html.includes("leftBarTopHiddenHoverTarget"),
		}).toStrictEqual({
			outer: '<div class="fixed left-0 bottom-0 transition-[top] duration-250 ease-base leftBar" style="z-index:200;top:0;width:var(--safe-area-inset-right)">',
			inner: '<div class="wf-left-bar absolute z-[2] box-border bg-secondary text-tertiary" style="top:0;bottom:0;left:0;width:296px;border-radius:0 0px 0px 0;overflow-x:hidden;transition:left 0.25s, bottom 0.25s">',
			shadow: `<div class="${SHADOW} duration-250 ease-base" style="border-radius:0 0px 0px 0;box-shadow:var(--wf-box-shadow-m);opacity:0">`,
			edge: '<div class="absolute top-0 bottom-0 -right-px w-px shadow-[0_2px_10px_rgba(0,0,0,0.5)]">',
			resize: '<div class="resizeTarget absolute top-0 bottom-0 right-0 w-[4px] cursor-ew-resize">',
			pin: `<div role="button" tabindex="0" style="transform:rotate(0deg)" class="${PIN} transition-[transform] duration-250 ease-base iconButton lg shape-circle">`,
			hoverTarget: false,
		});
	});

	it("renders the arrow-left icon inside the pin", () => {
		expect(render("alwaysOpen")).toContain('data-icon="arrow-left"');
	});
});

describe("LeftBarSection", () => {
	const header = (open: boolean) =>
		'<div class="relative pl-xl flex items-center font-normal text-secondary mb-m hover:cursor-pointer left-bar-section-header group ">' +
		`<div class="absolute -top-[3px] left-2xs flex items-center justify-center ${open ? "opacity-25" : "opacity-50"} hover:opacity-100 group-hover:opacity-100 sectionArrow ${open ? "expanded" : ""}">` +
		'<div><svg width="20" height="20" viewBox="0 0 20 20" class="block transition-transform duration-200 ease-base [.expanded_&amp;]:rotate-90">' +
		`<path d="${TRIANGLE_PATH}" stroke="none" fill="currentColor"></path></svg></div></div>Home</div>`;

	function renderSection(expansions: Record<string, boolean>): string {
		storeState.leftBarSectionExpansions = expansions;
		return renderToStaticMarkup(
			createElement(
				LeftBarSection,
				{name: "Home", contextKey: "leftbar__home__"},
				createElement("p", null, "kids"),
			),
		);
	}

	it("renders an open section by default with children and a 24px spacer", () => {
		expect(renderSection({})).toBe(`${header(true)}<p>kids</p><div style="margin-bottom:24px"></div>`);
	});

	it("renders a collapsed section without children and a 16px spacer", () => {
		expect(renderSection({leftbar__home__: false})).toBe(`${header(false)}<div style="margin-bottom:16px"></div>`);
	});

	it("persists the toggled state under its context key", () => {
		storeState.leftBarSectionExpansions = {};
		storeState.setLeftBarSectionExpanded.mockClear();
		const fragment = LeftBarSection({name: "Home", contextKey: "leftbar__home__"}) as {
			props: {children: [{props: {onClick: () => void}}]};
		};
		fragment.props.children[0].props.onClick();
		expect(storeState.setLeftBarSectionExpanded.mock.calls).toStrictEqual([["leftbar__home__", false]]);
	});
});

describe("Home section name", () => {
	it("navigates to the root without toggling the section", () => {
		navigateMock.mockClear();
		storeState.setLeftBarSectionExpanded.mockClear();
		const span = HomeSectionName() as {
			props: {className: string; children: string; onClick: (event: unknown) => void};
		};
		const stopPropagation = vi.fn<() => void>();
		span.props.onClick({stopPropagation});
		expect({
			className: span.props.className,
			children: span.props.children,
			navigate: navigateMock.mock.calls,
			stopped: stopPropagation.mock.calls.length,
			toggled: storeState.setLeftBarSectionExpanded.mock.calls,
		}).toStrictEqual({
			className: "hover:underline",
			children: "Home",
			navigate: [["/"]],
			stopped: 1,
			toggled: [],
		});
	});
});

describe("NewNodeButton", () => {
	it("renders upstream's pill button markup", () => {
		const html = renderToStaticMarkup(createElement(NewNodeButton)).replace(/ d="[^"]*"/u, "");
		expect(html).toBe(
			'<div class="mt-ml mx-xl"><button class="w-full cursor-pointer button" type="button"><span class="">' +
				'<svg aria-hidden="true" focusable="false" data-prefix="fal" data-icon="plus" class="svg-inline--fa fa-plus fa-1x mr-xs opacity-50" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="currentColor"></path></svg>' +
				" New node</span></button></div>",
		);
	});

	it("creates an empty node at the end of the root, ignoring the zoomed node, and edits it", () => {
		mutateMock.mockClear();
		storeState.startEditing.mockClear();
		storeState.zoomedNodeId = "abc";
		rootChildren = [{id: "a"}, {id: "b"}, {id: "c"}];
		const wrapper = NewNodeButton() as {props: {children: {props: {onClick: () => void}}}};
		wrapper.props.children.props.onClick();
		mutateMock.mock.calls[0]?.[1]?.onSuccess?.({id: "new-id"});
		expect({
			payloads: mutateMock.mock.calls.map((call) => call[0]),
			editing: storeState.startEditing.mock.calls,
		}).toStrictEqual({
			payloads: [{name: "", position: 3}],
			editing: [["new-id"]],
		});
		storeState.zoomedNodeId = null;
		rootChildren = [];
	});
});

describe("resizeWidth", () => {
	it("follows the pointer and clamps to 160", () => {
		expect([resizeWidth(296, 296, 350), resizeWidth(296, 296, 200), resizeWidth(296, 296, 10)]).toStrictEqual([
			350, 200, 160,
		]);
	});
});

describe("applyBodyOffset", () => {
	it("pads the body by the offset with upstream's transition", () => {
		const pinned = {transition: "", paddingLeft: ""};
		const drawer = {transition: "", paddingLeft: ""};
		applyBodyOffset(pinned, 296);
		applyBodyOffset(drawer, 0);
		expect([pinned, drawer]).toStrictEqual([
			{transition: "padding-left .25s", paddingLeft: "296px"},
			{transition: "padding-left .25s", paddingLeft: "0px"},
		]);
	});
});

describe("left bar styles", () => {
	const styles = readFileSync(fileURLToPath(new URL("../src/client/styles.css", import.meta.url)), "utf8").replaceAll(
		/\/\*[\s\S]*?\*\//gu,
		"",
	);

	it("compensates the body line-height on .wf-left-bar", () => {
		expect(/\.wf-left-bar\s*\{\s*line-height:\s*1;\s*font-size:\s*16px;\s*\}/u.test(styles)).toBe(true);
	});

	it("hides the left bar when printing", () => {
		expect(/@media print\s*\{\s*\.leftBar\s*\{\s*display:\s*none;\s*\}\s*\}/u.test(styles)).toBe(true);
	});

	it("drops the with-sidebar margin rule", () => {
		expect(styles.includes("with-sidebar")).toBe(false);
	});

	it("removes the body padding when printing", () => {
		expect(/@media print\s*\{\s*body\s*\{\s*padding-left:\s*0\s*!important;?\s*\}\s*\}/u.test(styles)).toBe(true);
	});
});
