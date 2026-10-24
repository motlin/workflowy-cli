import {describe, expect, it} from "vite-plus/test";
import {crumbLabel, friendlyPrefix} from "../src/client/crumb-label.js";

const SEP_4 = '<time startYear="2026" startMonth="9" startDay="4">Fri, Sep 4, 2026</time>';

describe("crumbLabel", () => {
	it("resolves stored mentions to plain names", () => {
		const html = 'MP sys <mention id="-2" by="1" ts="1"> </mention> <mention id="-10" by="1" ts="1"> </mention> x';
		expect(crumbLabel(html, {now: new Date(2026, 9, 1)})).toBe("MP sys Workflowy AI x");
	});

	it("resolves the current user's mention to the account full name", () => {
		expect(
			crumbLabel('hi <mention id="7" by="7" ts="1"> </mention>', {
				now: new Date(2026, 9, 1),
				account: {userId: 7, fullName: "Alice Smith"},
			}),
		).toBe("hi Alice Smith");
	});

	it("formats a day <time> with the default date format", () => {
		expect(crumbLabel(SEP_4, {now: new Date(2026, 9, 1)})).toBe("2026-09-04 Fri");
	});

	it("prefixes Today for a single-day name on the current day", () => {
		expect(crumbLabel(SEP_4, {now: new Date(2026, 8, 4)})).toBe("Today, 2026-09-04 Fri");
	});

	it("prefixes Yesterday for a single-day name on the previous day", () => {
		expect(crumbLabel(SEP_4, {now: new Date(2026, 8, 5)})).toBe("Yesterday, 2026-09-04 Fri");
	});

	it("prefixes Tomorrow for a single-day name on the next day", () => {
		expect(crumbLabel(SEP_4, {now: new Date(2026, 8, 3, 23, 59)})).toBe("Tomorrow, 2026-09-04 Fri");
	});

	it("omits the prefix when dayPrefix is false", () => {
		expect(crumbLabel(SEP_4, {now: new Date(2026, 8, 4), dayPrefix: false})).toBe("2026-09-04 Fri");
	});

	it("omits the prefix when the <time> is embedded in other text", () => {
		expect(crumbLabel(`Party ${SEP_4}`, {now: new Date(2026, 8, 4)})).toBe("Party 2026-09-04 Fri");
	});

	it("honors a custom date format", () => {
		expect(crumbLabel(SEP_4, {now: new Date(2026, 9, 1), dateFormat: "ddd, MMM D"})).toBe("Fri, Sep 4");
	});

	it("strips other tags and decodes entities", () => {
		expect(crumbLabel("<b>Alice</b> &amp; Bob", {now: new Date(2026, 9, 1)})).toBe("Alice & Bob");
	});

	it("keeps month and year names as-is", () => {
		expect(crumbLabel("09", {now: new Date(2026, 9, 1)})).toBe("09");
		expect(crumbLabel("2026", {now: new Date(2026, 9, 1)})).toBe("2026");
	});

	it("returns an empty string for an empty name", () => {
		expect(crumbLabel("", {now: new Date(2026, 9, 1)})).toBe("");
	});
});

describe("friendlyPrefix", () => {
	const date = new Date(2026, 8, 4);

	it("names adjacent days and returns null otherwise", () => {
		expect([
			friendlyPrefix(date, new Date(2026, 8, 5, 8)),
			friendlyPrefix(date, new Date(2026, 8, 4, 23)),
			friendlyPrefix(date, new Date(2026, 8, 3)),
			friendlyPrefix(date, new Date(2026, 8, 6)),
		]).toStrictEqual(["Yesterday", "Today", "Tomorrow", null]);
	});
});

describe("crumbLabel with malformed <time>", () => {
	it("shows Invalid date for a time element with no units", () => {
		expect(crumbLabel("<time>z</time>", {now: new Date(2026, 9, 23, 10)})).toBe("Invalid date");
	});
});
