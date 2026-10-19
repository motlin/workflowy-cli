import {describe, expect, it} from "vite-plus/test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {FA_ICONS, FaIcon, TRIANGLE_PATH, TriangleSvg} from "../src/client/components/fa-icons.js";

const SEED_KEYS = new Set([
	"fal:bars",
	"fal:chevron-left",
	"fal:chevron-right",
	"fal:house",
	"fal:calendar-day",
	"fal:user-plus",
	"fal:play",
	"fal:check",
	"fal:list-ul",
	"fal:ellipsis-vertical",
	"fal:ellipsis",
	"fal:arrow-left",
	"fal:plus",
	"fal:pencil",
	"fas:star",
	"fas:magnifying-glass",
]);

describe("FA_ICONS", () => {
	it("holds the header, sidebar, menu and picker icon set", () => {
		expect(Object.keys(FA_ICONS)).toStrictEqual([
			"fal:bars",
			"fal:chevron-left",
			"fal:chevron-right",
			"fal:house",
			"fal:calendar-day",
			"fal:user-plus",
			"fal:play",
			"fal:check",
			"fal:list-ul",
			"fal:ellipsis-vertical",
			"fal:ellipsis",
			"fal:arrow-left",
			"fal:plus",
			"fal:clock",
			"fal:arrow-up",
			"fal:pencil",
			"fas:star",
			"fas:magnifying-glass",
			"fal:arrows-cross",
			"fal:chevron-down",
			"fal:table-columns",
			"fal:calendar-days",
			"fal:message-lines",
			"fal:arrow-right-long",
			"fal:calendar-circle-plus",
			"fal:calendar-week",
			"fal:file",
			"fal:diamond-turn-right",
			"fal:diamond",
			"fal:copy",
			"fal:user-group",
			"fal:file-export",
			"fal:link",
			"fal:puzzle-piece",
			"fal:trash-can",
			"fal:up-right-and-down-left-from-center",
			"fal:down-left-and-up-right-to-center",
			"fal:arrow-down-a-z",
			"fal:arrow-down-z-a",
			"fal:xmark",
			"fas:circle-check",
			"fal:h1",
			"fal:h2",
			"fal:h3",
			"fal:paragraph",
			"fal:list-check",
			"fal:list-ol",
			"fal:columns-3",
			"fal:table-cells",
			"fal:block-quote",
			"fal:rectangle-code",
			"fal:horizontal-rule",
			"fal:sun-bright",
			"fal:moon",
			"fal:gear",
			"fal:ban",
			"fas:circle-small",
			"fal:ellipsis-h",
			"far:font",
			"far:h1",
			"far:h2",
			"far:h3",
			"far:paragraph",
			"far:bold",
			"far:underline",
			"far:italic",
			"far:strikethrough",
			"far:code",
			"far:link",
			"far:chevron-down",
		]);
	});

	it("uses the upstream light-weight paths and sizes", () => {
		expect({
			house: FA_ICONS["fal:house"].d.startsWith("M298.6 4c-6-5.3-15.1-5.3-21.2 0L5.4 244c"),
			calendarDay: FA_ICONS["fal:calendar-day"].d.startsWith("M128 16c0-8.8-7.2-16-16-16s-16 7.2-16 16"),
			sizes: Object.fromEntries(
				Object.entries(FA_ICONS)
					.filter(([key]) => SEED_KEYS.has(key))
					.map(([key, icon]) => [key, `${icon.width}x${icon.height}`]),
			),
		}).toStrictEqual({
			house: true,
			calendarDay: true,
			sizes: {
				"fal:bars": "448x512",
				"fal:chevron-left": "320x512",
				"fal:chevron-right": "320x512",
				"fal:house": "576x512",
				"fal:calendar-day": "448x512",
				"fal:user-plus": "640x512",
				"fal:play": "384x512",
				"fal:check": "448x512",
				"fal:list-ul": "512x512",
				"fal:ellipsis-vertical": "128x512",
				"fal:ellipsis": "448x512",
				"fal:arrow-left": "448x512",
				"fal:plus": "448x512",
				"fal:pencil": "512x512",
				"fas:star": "576x512",
				"fas:magnifying-glass": "512x512",
			},
		});
	});
});

describe("FaIcon", () => {
	it("renders upstream's FontAwesome react markup with a trailing class space", () => {
		const markup = renderToStaticMarkup(createElement(FaIcon, {icon: "fal:house", size: "lg"})).replace(
			/ d="[^"]*"/u,
			' d=""',
		);
		expect(markup).toBe(
			'<svg aria-hidden="true" focusable="false" data-prefix="fal" data-icon="house" class="svg-inline--fa fa-house fa-lg " role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><path fill="currentColor" d=""></path></svg>',
		);
	});

	it("defaults to 1x and appends className and style", () => {
		const markup = renderToStaticMarkup(
			createElement(FaIcon, {icon: "fas:star", className: "text-tertiary", style: {width: 14}}),
		).replace(/ d="[^"]*"/u, ' d=""');
		expect(markup).toBe(
			'<svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="star" class="svg-inline--fa fa-star fa-1x text-tertiary" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" style="width:14px"><path fill="currentColor" d=""></path></svg>',
		);
	});

	it("adds fa-fw before the size when fixedWidth", () => {
		expect(renderToStaticMarkup(createElement(FaIcon, {icon: "fal:check", fixedWidth: true}))).toBe(
			'<svg aria-hidden="true" focusable="false" data-prefix="fal" data-icon="check" class="svg-inline--fa fa-check fa-fw fa-1x " role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path fill="currentColor" d="M443.3 100.7c6.2 6.2 6.2 16.4 0 22.6l-272 272c-6.2 6.2-16.4 6.2-22.6 0l-144-144c-6.2-6.2-6.2-16.4 0-22.6s16.4-6.2 22.6 0L160 361.4 420.7 100.7c6.2-6.2 16.4-6.2 22.6 0z"></path></svg>',
		);
	});

	it("replaces fa-1x with the size class before className", () => {
		const markup = renderToStaticMarkup(
			createElement(FaIcon, {icon: "fas:circle-check", className: "text-success", size: "lg"}),
		);
		expect(markup.match(/class="([^"]*)"/u)?.[1]).toBe("svg-inline--fa fa-circle-check fa-lg text-success");
	});

	it("renders the ellipsis-h alias as upstream's fal ellipsis", () => {
		expect(renderToStaticMarkup(createElement(FaIcon, {icon: "fal:ellipsis-h", fixedWidth: true}))).toBe(
			renderToStaticMarkup(createElement(FaIcon, {icon: "fal:ellipsis", fixedWidth: true})),
		);
	});
});

describe("TriangleSvg", () => {
	it("renders the upstream expand triangle", () => {
		expect(renderToStaticMarkup(createElement(TriangleSvg, {className: "x"}))).toBe(
			`<svg width="20" height="20" viewBox="0 0 20 20" class="x"><path d="${TRIANGLE_PATH}" stroke="none" fill="currentColor"></path></svg>`,
		);
		expect(TRIANGLE_PATH).toBe(
			"M13.75 9.56879C14.0833 9.76124 14.0833 10.2424 13.75 10.4348L8.5 13.4659C8.16667 13.6584 7.75 13.4178 7.75 13.0329L7.75 6.97072C7.75 6.58582 8.16667 6.34525 8.5 6.5377L13.75 9.56879Z",
		);
	});
});
