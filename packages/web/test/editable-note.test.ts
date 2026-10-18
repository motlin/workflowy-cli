import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {describe, expect, it, vi} from "vite-plus/test";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {projectClassName} from "../src/client/components/row-classes.js";
import {DEFAULT_DATE_SETTINGS, renderDatePills} from "../src/client/date-pills.js";

const outlineState = {
	focusNote: () => {},
	focusName: () => {},
	blurNote: () => {},
	openSearchFromEditing: () => {},
};

vi.mock("../src/client/stores/outline.js", () => ({
	useOutlineStore: (selector?: (state: typeof outlineState) => unknown) =>
		selector ? selector(outlineState) : outlineState,
	registerEditFlush: () => () => {},
}));
vi.mock("../src/client/hooks/use-nodes.js", () => ({
	useUpdateNode: () => ({mutate: () => {}}),
}));

const {EditableNote} = await import("../src/client/components/editable-note.js");

function render(props: {initialValue: string; isFocused?: boolean; isMain?: boolean}): string {
	return renderToStaticMarkup(
		createElement(
			QueryClientProvider,
			{client: new QueryClient()},
			createElement(EditableNote, {nodeId: "alice", isFocused: false, ...props}),
		),
	);
}

describe("EditableNote markup", () => {
	it("renders date pills while unfocused and the raw <time> while focused", () => {
		const note = 'due <time startYear="2026" startMonth="10" startDay="1">Thu, Oct 1, 2026</time>';
		const open =
			'<div class="notes"><div class="notranslate content text-tertiary whitespace-pre-wrap overflow-hidden';
		expect({
			unfocused: render({initialValue: note}),
			focused: render({initialValue: note, isFocused: true}),
		}).toStrictEqual({
			unfocused: `${open}" contentEditable="true"><span class="innerContentContainer">${renderDatePills(note, DEFAULT_DATE_SETTINGS)}</span></div></div>`,
			focused: `${open} active" contentEditable="true"><span class="innerContentContainer">${note}</span></div></div>`,
		});
	});

	it("renders one always-contenteditable content div", () => {
		expect(render({initialValue: "Alice\nBob"})).toBe(
			'<div class="notes"><div class="notranslate content text-tertiary whitespace-pre-wrap overflow-hidden" contentEditable="true"><span class="innerContentContainer">Alice\nBob</span></div></div>',
		);
	});

	it("adds notes--main for the zoom root's note", () => {
		expect(render({initialValue: "Alice", isMain: true})).toBe(
			'<div class="notes notes--main"><div class="notranslate content text-tertiary whitespace-pre-wrap overflow-hidden" contentEditable="true"><span class="innerContentContainer">Alice</span></div></div>',
		);
	});

	it("renders an empty content div for an empty note", () => {
		expect(render({initialValue: ""})).toBe(
			'<div class="notes"><div class="notranslate content text-tertiary whitespace-pre-wrap overflow-hidden" contentEditable="true"></div></div>',
		);
	});

	it("marks the focused note's content active", () => {
		expect(render({initialValue: "Alice", isFocused: true})).toBe(
			'<div class="notes"><div class="notranslate content text-tertiary whitespace-pre-wrap overflow-hidden active" contentEditable="true"><span class="innerContentContainer">Alice</span></div></div>',
		);
	});
});

const LEAF = {
	hasChildren: false,
	expanded: false,
	completed: false,
	isZoomRoot: false,
	hasMirrors: false,
	highlighted: false,
	addedToSelection: false,
};

describe("noted", () => {
	it("is set while an empty note is focused and dropped on blur", () => {
		expect({
			focused: projectClassName({...LEAF, hasNote: false, noteFocused: true})
				.split(" ")
				.includes("noted"),
			blurred: projectClassName({...LEAF, hasNote: false, noteFocused: false})
				.split(" ")
				.includes("noted"),
		}).toStrictEqual({focused: true, blurred: false});
	});
});

const styles = readFileSync(fileURLToPath(new URL("../src/client/styles.css", import.meta.url)), "utf8");

function normalizeCss(css: string): string {
	return css
		.replaceAll(/\/\*[\s\S]*?\*\//gu, "")
		.replaceAll(/\s*([{}:;,>()])\s*/gu, "$1")
		.replaceAll(/\s+/gu, " ")
		.replaceAll(";}", "}");
}

describe("note behavior CSS", () => {
	const css = normalizeCss(styles);

	it("drops the click-to-expand and editing-chrome rules", () => {
		expect({
			outlineNodeNote: styles.includes(".outline-node-note"),
			expanded: css.includes(".notes>.content.expanded"),
		}).toStrictEqual({outlineNodeNote: false, expanded: false});
	});

	it("contains upstream's note behavior rules", () => {
		const rules = [
			".noted>.notes>.content.active,.root>.notes>.content{overflow:visible;display:block;max-height:none;height:auto}",
			'.content:empty:before{content:" ";width:0;display:block}',
			".notes>.content>.innerContentContainer::selection,.notes>.content>.innerContentContainer>*::selection{color:var(--wf-text-secondary);background:var(--wf-background-selected)}",
			".noted>.name>.content{padding-bottom:0}",
			".notes>.content{outline:none}",
		];
		expect(rules.filter((rule) => !css.includes(normalizeCss(rule)))).toStrictEqual([]);
	});
});
