import {describe, expect, it} from "vite-plus/test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {FA_ICONS, FaIcon, TRIANGLE_PATH, TriangleSvg} from "../src/client/components/fa-icons.js";

describe("FA_ICONS", () => {
	it("seeds the upstream header and sidebar icons in order", () => {
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
			"fal:pencil",
			"fas:star",
			"fas:magnifying-glass",
		]);
	});

	it("uses the upstream light-weight paths and sizes", () => {
		expect({
			house: FA_ICONS["fal:house"].d.startsWith("M298.6 4c-6-5.3-15.1-5.3-21.2 0L5.4 244c"),
			calendarDay: FA_ICONS["fal:calendar-day"].d.startsWith("M128 16c0-8.8-7.2-16-16-16s-16 7.2-16 16"),
			sizes: Object.fromEntries(
				Object.entries(FA_ICONS).map(([key, icon]) => [key, `${icon.width}x${icon.height}`]),
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
