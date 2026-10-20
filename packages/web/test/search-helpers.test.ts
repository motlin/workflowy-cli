import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vite-plus/test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {SearchHelpers} from "../src/client/components/search-helpers.js";
import type {SearchHelpersProps} from "../src/client/components/search-helpers.js";
import {helperKeyReducer} from "../src/client/search/helper-keys.js";
import type {HelperLayout, HelperSelection} from "../src/client/search/helper-keys.js";
import {cssBlock} from "./helpers/css-block.js";

const styles = readFileSync(fileURLToPath(new URL("../src/client/styles.css", import.meta.url)), "utf8");

const TAB_CLASS = 'class="py-2xs px-ml rounded-[16px] !text-on-surface !bg-transparent"';
const SELECTED_TAB_CLASS = 'class="py-2xs px-ml rounded-[16px] !bg-secondary"';

function render(overrides: Partial<SearchHelpersProps> = {}): string {
	const props: SearchHelpersProps = {
		query: "",
		focused: true,
		autocompletePopulated: false,
		tags: {hashTags: ["#soTag"], atTags: ["@soPerson"]},
		selection: {tab: -1, chip: -1},
		onHoverTab: () => {},
		onInsert: () => {},
		...overrides,
	};
	return renderToStaticMarkup(createElement(SearchHelpers, props));
}

function count(html: string, needle: string): number {
	return html.split(needle).length - 1;
}

function icons(html: string): string[] {
	return [...html.matchAll(/data-icon="([^"]+)"/gu)].map((match) => match[1]);
}

function chipTexts(html: string): string[] {
	return [...html.matchAll(/desktop:text-xs">([^<]*)</gu)].map((match) => match[1]);
}

function stripTags(html: string): string {
	return html.replaceAll(/<[^>]+>/gu, "");
}

describe("SearchHelpers", () => {
	it("renders seven unselected tabs in upstream icon order and no chips", () => {
		const html = render();
		expect({
			tabs: count(html, TAB_CLASS),
			icons: icons(html),
			menuItems: count(html, "menuItem"),
		}).toStrictEqual({
			tabs: 7,
			icons: ["globe", "hashtag", "at", "calendar-days", "clock-rotate-left", "users", "ellipsis"],
			menuItems: 0,
		});
	});

	it("renders the exact upstream flyout wrapper and tab markup", () => {
		const html = render();
		expect(html).toContain(
			'<div class=""><div class="wf-header flex flex-col border border-solid border-primary font-normal text-xs rounded-md bg-primary shadow-md overflow-x-hidden [transition:200ms_opacity] print:hidden absolute flyout menu !-mt-px !px-[5%] !pt-0 !pb-[2px] !bg-primary !border-primary"',
		);
		expect(html).toContain(
			`<div class="relative py-s shrink-0 flex justify-around overflow-hidden"><div ${TAB_CLASS}><svg aria-hidden="true" focusable="false" data-prefix="fal" data-icon="globe" class="svg-inline--fa fa-globe fa-sm " role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">`,
		);
	});

	it("tints the flyout border once the query is non-empty", () => {
		const html = render({query: "x"});
		expect({
			tint: count(html, "!bg-primary !border-[var(--wf-border-tint)]"),
			primary: count(html, '!border-primary"'),
		}).toStrictEqual({
			tint: 1,
			primary: 0,
		});
	});

	it("omits the #TAGS tab when there are no hash tags", () => {
		const html = render({tags: {hashTags: [], atTags: ["@soPerson"]}});
		expect({tabs: count(html, TAB_CLASS), icons: icons(html)}).toStrictEqual({
			tabs: 6,
			icons: ["globe", "at", "calendar-days", "clock-rotate-left", "users", "ellipsis"],
		});
	});

	it("omits the @TAGS tab when there are no at tags", () => {
		const html = render({tags: {hashTags: ["#soTag"], atTags: []}});
		expect(icons(html)).toStrictEqual([
			"globe",
			"hashtag",
			"calendar-days",
			"clock-rotate-left",
			"users",
			"ellipsis",
		]);
	});

	it("shows the dates chips in order and selects the fourth tab", () => {
		const html = render({selection: {tab: 3, chip: -1}});
		const tabClasses = [...html.matchAll(/<div (class="py-2xs px-ml[^"]*")>/gu)].map((match) => match[1]);
		expect({
			chips: chipTexts(html),
			tabClasses,
		}).toStrictEqual({
			chips: [
				"date:",
				"date-before:",
				"date-after:",
				"day-of-week:",
				"today",
				"tomorrow",
				"yesterday",
				"this week",
				"next week",
				"last week",
				"this month",
				"next month",
				"last month",
			],
			tabClasses: [TAB_CLASS, TAB_CLASS, TAB_CLASS, SELECTED_TAB_CLASS, TAB_CLASS, TAB_CLASS, TAB_CLASS],
		});
	});

	it("renders the exact upstream chip markup and highlights the active chip", () => {
		const html = render({selection: {tab: 3, chip: 1}});
		const chip = (text: string, state: string) =>
			`<div class="min-w-0 py-xs px-px"><a class="pl-l py-xs pr-l block !no-underline cursor-pointer whitespace-nowrap leading-base border-solid border-primary text-primary hover:bg-secondary menuItem !py-0 !px-s !flex text-xs rounded-[16px] [&amp;_span]:whitespace-nowrap [&amp;_span]:text-ellipsis [&amp;_span]:overflow-hidden ${state} canHover" style="height:20px"><span class="relative flex justify-between items-center"><span class="grow flex items-center gap-m whitespace-nowrap text-ellipsis overflow-hidden desktop:text-xs">${text}</span></span></a></div>`;
		expect(html).toContain(
			`<div><div class="shrink-0 h-auto flex overflow-hidden [&amp;:not(:last-child)]:mb-ml"><div class="relative min-w-0 flex flex-row flex-wrap items-center">${chip("date:", "!text-on-surface !bg-transparent")}${chip("date-before:", "!bg-secondary active")}`,
		);
	});

	it("labels the changed-by chips me and others", () => {
		expect(chipTexts(render({selection: {tab: 5, chip: -1}}))).toStrictEqual(["me", "others"]);
	});

	it("lists the tag values under their tabs", () => {
		expect({
			hash: chipTexts(render({selection: {tab: 1, chip: -1}})),
			at: chipTexts(render({selection: {tab: 2, chip: -1}})),
			operators: chipTexts(render({selection: {tab: 6, chip: -1}})),
		}).toStrictEqual({
			hash: ["#soTag"],
			at: ["@soPerson"],
			operators: ["is:", "has:", "in:", "text:", "link:", "highlight:"],
		});
	});

	it("shows the jump-to hint on the globe tab", () => {
		const html = render({selection: {tab: 0, chip: -1}});
		const hint =
			html.match(
				/<div class="pt-\[5px\] pb-\[3px\] text-\[12px\] leading-\[16px\] text-center">.*?<\/div>/u,
			)?.[0] ?? "";
		expect(stripTags(hint)).toBe("For the jump to-menu, hit enter now,  or meta+k from anywhere.");
	});

	it("hides the wrapper while the autocomplete is populated or the input is blurred", () => {
		expect({
			populated: render({autocompletePopulated: true}).startsWith('<div class="hidden">'),
			blurred: render({focused: false}).startsWith('<div class="hidden">'),
		}).toStrictEqual({populated: true, blurred: true});
	});
});

describe("helperKeyReducer", () => {
	const layout: HelperLayout = {tabCount: 7, chipRows: [0, 0, 0, 1, 1, 1, 2]};

	function run(start: HelperSelection, keys: string[]): HelperSelection[] {
		const states: HelperSelection[] = [];
		let state = start;
		for (const key of keys) {
			state = helperKeyReducer(state, key, layout);
			states.push(state);
		}
		return states;
	}

	it("walks from nothing into the tabs, the chips and back out", () => {
		expect(
			run({tab: -1, chip: -1}, ["ArrowDown", "ArrowRight", "ArrowDown", "ArrowRight", "ArrowUp", "ArrowUp"]),
		).toStrictEqual([
			{tab: 0, chip: -1},
			{tab: 1, chip: -1},
			{tab: 1, chip: 0},
			{tab: 1, chip: 1},
			{tab: 1, chip: -1},
			{tab: -1, chip: -1},
		]);
	});

	it("clamps the tab at both ends", () => {
		expect({
			left: helperKeyReducer({tab: 0, chip: -1}, "ArrowLeft", layout),
			right: helperKeyReducer({tab: 6, chip: -1}, "ArrowRight", layout),
		}).toStrictEqual({left: {tab: 0, chip: -1}, right: {tab: 6, chip: -1}});
	});

	it("moves between visual chip rows keeping the column, clamped to the row", () => {
		expect(run({tab: 3, chip: 1}, ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowUp", "ArrowLeft"])).toStrictEqual([
			{tab: 3, chip: 4},
			{tab: 3, chip: 6},
			{tab: 3, chip: 6},
			{tab: 3, chip: 3},
			{tab: 3, chip: 2},
		]);
	});

	it("does not enter a panel without chips", () => {
		expect(helperKeyReducer({tab: 0, chip: -1}, "ArrowDown", {tabCount: 7, chipRows: []})).toStrictEqual({
			tab: 0,
			chip: -1,
		});
	});

	it("ignores other keys", () => {
		expect(helperKeyReducer({tab: 2, chip: -1}, "a", layout)).toStrictEqual({tab: 2, chip: -1});
	});
});

describe("search helper flyout CSS", () => {
	it("matches upstream's computed line-height, icon box and selected-tab underline", () => {
		expect({
			lineHeight: cssBlock(styles, ".searchBox .flyout")["line-height"],
			icon: cssBlock(styles, ".searchBox .flyout .fa-sm"),
			underline: cssBlock(styles, String.raw`.searchBox .flyout .justify-around.after\:absolute::after`),
		}).toStrictEqual({
			lineHeight: "1",
			icon: {height: "1em", width: "auto"},
			underline: {
				content: '""',
				position: "absolute",
				"z-index": "1",
				top: "100%",
				right: "0",
				bottom: "0",
				left: "0",
				height: "1px",
				"margin-top": "-1px",
				"background-color": "transparent",
			},
		});
	});
});
