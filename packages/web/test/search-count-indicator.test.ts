import {describe, expect, it, vi} from "vite-plus/test";
import {createElement, isValidElement} from "react";
import type {ReactNode} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import type {SearchCountIndicatorProps} from "../src/client/components/search-count-indicator.js";

vi.mock("../src/client/stores/outline.js", () => ({useOutlineStore: () => {}}));
vi.mock("../src/client/hooks/use-tree-search.js", () => ({useSearchProgress: () => {}}));

const {SearchCountIndicatorView} = await import("../src/client/components/search-count-indicator.js");

const PILL_CLASS =
	" matching-node fixed mobile:bottom-[64px] desktop:bottom-l min-w-[256px] flex items-center justify-center px-l py-m rounded-pill bg-secondary whitespace-nowrap text-secondary overflow-hidden text-s ";

function props(overrides: Partial<SearchCountIndicatorProps>): SearchCountIndicatorProps {
	return {
		matchCount: 4,
		completedMatchCount: 1,
		showCompleted: false,
		editingId: null,
		searching: false,
		onToggleCompleted: () => {},
		...overrides,
	};
}

function render(overrides: Partial<SearchCountIndicatorProps>): string {
	return renderToStaticMarkup(createElement(SearchCountIndicatorView, props(overrides)));
}

/** Depth-first search of a rendered element tree for the first element whose className is `className`. */
function findByClass(node: ReactNode, className: string): {onClick?: () => void} | undefined {
	if (!isValidElement<{className?: string; children?: ReactNode; onClick?: () => void}>(node)) {
		return Array.isArray(node) ? node.map((child) => findByClass(child, className)).find(Boolean) : undefined;
	}
	if (node.props.className === className) {
		return node.props;
	}
	const {children} = node.props;
	return (Array.isArray(children) ? children : [children])
		.map((child: ReactNode) => findByClass(child, className))
		.find(Boolean);
}

describe("SearchCountIndicatorView", () => {
	it("renders upstream's pill with the match count and the hidden-completed toggle", () => {
		const html = render({});
		expect({
			wrapper: html.startsWith('<div class="flex justify-center print:hidden">'),
			pill: html.includes(
				`<span class="${PILL_CLASS}" style="margin-bottom:var(--safe-area-inset-bottom);z-index:500">`,
			),
			count: html.includes("<span>4 Matches</span>"),
			divider: html.includes('<div class=" border-solid border-l-[1px] border-primary h-full mx-m "></div>'),
			toggle: html.includes(
				'<div class="flex cursor-pointer h-full items-center "><span class="mr-s">1 completed</span><div class="w-[20px] flex justify-center"><svg',
			),
			icon: html.includes('data-icon="eye-slash"'),
			trailingSpace: html.endsWith("</div></div> </span></div>"),
		}).toStrictEqual({
			wrapper: true,
			pill: true,
			count: true,
			divider: true,
			toggle: true,
			icon: true,
			trailingSpace: true,
		});
	});

	it("uses the singular and omits the toggle when no completed item matches", () => {
		const html = render({matchCount: 1, completedMatchCount: 0});
		expect({
			single: html.includes("<span>1 Match</span>"),
			toggle: html.includes("mr-s"),
			divider: html.includes("mx-m"),
		}).toStrictEqual({single: true, toggle: false, divider: false});
	});

	it("shows the eye icon while completed items are shown", () => {
		const html = render({showCompleted: true});
		expect({eye: html.includes('data-icon="eye"'), slash: html.includes("eye-slash")}).toStrictEqual({
			eye: true,
			slash: false,
		});
	});

	it("renders nothing while a row is being edited", () => {
		expect(render({editingId: "x"})).toBe("");
	});

	it("shows only the spinner and 'Still searching' while the search runs", () => {
		const html = render({searching: true});
		expect({
			still: html.includes(" Still searching <div"),
			spinner: html.includes('class="loading-spinner loading-spinner-small"'),
			count: html.includes("Matches"),
			toggle: html.includes("mr-s"),
		}).toStrictEqual({still: true, spinner: true, count: false, toggle: false});
	});

	it("calls onToggleCompleted once when the toggle is clicked", () => {
		const onToggleCompleted = vi.fn<() => void>();
		const tree = SearchCountIndicatorView(props({onToggleCompleted}));
		findByClass(tree, "flex cursor-pointer h-full items-center ")?.onClick?.();
		expect(onToggleCompleted).toHaveBeenCalledOnce();
	});
});
