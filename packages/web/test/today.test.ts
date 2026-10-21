import {describe, expect, it} from "vite-plus/test";
import {navigateToCalendarDate, navigateToToday} from "../src/client/today.js";

interface Reply {
	status: number;
	body: unknown;
}

/** Records every call in order and answers each fetch with the next scripted reply. */
function harness(replies: Reply[]) {
	const calls: unknown[][] = [];
	const queue = [...replies];
	const fetch = async (url: string, init?: {method?: string}): Promise<Response> => {
		calls.push(["fetch", url, init?.method ?? "GET"]);
		const reply = queue.shift();
		if (reply === undefined) {
			throw new Error(`unexpected fetch ${url}`);
		}
		return Promise.resolve(Response.json(reply.body, {status: reply.status}));
	};
	return {
		calls,
		deps: {
			fetch,
			zoomTo: (id: string) => {
				calls.push(["zoomTo", id]);
			},
			notify: (message: string, type: "info") => {
				calls.push(["notify", message, type]);
			},
			startEditing: (id: string, offset: number) => {
				calls.push(["startEditing", id, offset]);
			},
			commitEdit: () => {
				calls.push(["commitEdit"]);
			},
			now: new Date(2026, 9, 17),
		},
	};
}

describe("navigateToToday", () => {
	it("commits the edit, then zooms to a found day node that has no children", async () => {
		const {calls, deps} = harness([
			{status: 200, body: {id: "aaaaaaaa-0000-0000-0000-day000000001", firstChildId: null}},
		]);
		await navigateToToday(deps);
		expect(calls).toStrictEqual([
			["commitEdit"],
			["fetch", "/api/v1/calendar/day/20261017", "GET"],
			["zoomTo", "aaaaaaaa-0000-0000-0000-day000000001"],
		]);
	});

	it("edits the found day's first child", async () => {
		const {calls, deps} = harness([{status: 200, body: {id: "day000000001", firstChildId: "kid000000001"}}]);
		await navigateToToday(deps);
		expect(calls).toStrictEqual([
			["commitEdit"],
			["fetch", "/api/v1/calendar/day/20261017", "GET"],
			["zoomTo", "day000000001"],
			["startEditing", "kid000000001", 0],
		]);
	});

	it("ensures a missing day, then zooms in with the caret in its first child", async () => {
		const {calls, deps} = harness([
			{status: 404, body: {error: "Calendar day not found"}},
			{status: 200, body: {dayId: "day000000002", firstChildId: "kid000000002", created: ["day000000002"]}},
		]);
		await navigateToToday(deps);
		expect(calls).toStrictEqual([
			["commitEdit"],
			["fetch", "/api/v1/calendar/day/20261017", "GET"],
			["fetch", "/api/v1/calendar/day/20261017/ensure", "POST"],
			["zoomTo", "day000000002"],
			["startEditing", "kid000000002", 0],
		]);
	});

	it.each([403, 404, 503])("notifies once and stays put when ensure answers %i", async (status) => {
		const {calls, deps} = harness([
			{status: 404, body: {error: "Calendar day not found"}},
			{status, body: {error: "unavailable"}},
		]);
		await navigateToToday(deps);
		expect(calls).toStrictEqual([
			["commitEdit"],
			["fetch", "/api/v1/calendar/day/20261017", "GET"],
			["fetch", "/api/v1/calendar/day/20261017/ensure", "POST"],
			["notify", "No calendar page for 2026-10-17 yet", "info"],
		]);
	});
});

describe("navigateToCalendarDate", () => {
	it("finds the month node holding a date with ?level=, then ensures it without a child when asked", async () => {
		const {calls, deps} = harness([
			{status: 404, body: {error: "Calendar day not found"}},
			{status: 200, body: {dayId: "month0000001", firstChildId: null, created: ["month0000001"]}},
		]);
		await navigateToCalendarDate({date: new Date(2026, 10, 1), level: "month", createChild: false}, deps);
		expect(calls).toStrictEqual([
			["commitEdit"],
			["fetch", "/api/v1/calendar/day/20261101?level=month", "GET"],
			["fetch", "/api/v1/calendar/day/20261101/ensure?level=month&createChild=false", "POST"],
			["zoomTo", "month0000001"],
		]);
	});

	it("zooms to another day and names the month or year in the notification", async () => {
		const day = harness([{status: 200, body: {id: "day000000003", firstChildId: "kid000000003"}}]);
		await navigateToCalendarDate({date: new Date(2026, 8, 30)}, day.deps);
		const year = harness([
			{status: 404, body: {error: "Calendar day not found"}},
			{status: 403, body: {error: "disabled"}},
		]);
		await navigateToCalendarDate({date: new Date(2027, 0, 1), level: "year"}, year.deps);
		const week = harness([
			{status: 404, body: {error: "Calendar day not found"}},
			{status: 403, body: {error: "disabled"}},
		]);
		await navigateToCalendarDate({date: new Date(2026, 9, 11), level: "week"}, week.deps);
		expect({day: day.calls, year: year.calls, week: week.calls}).toStrictEqual({
			day: [
				["commitEdit"],
				["fetch", "/api/v1/calendar/day/20260930", "GET"],
				["zoomTo", "day000000003"],
				["startEditing", "kid000000003", 0],
			],
			year: [
				["commitEdit"],
				["fetch", "/api/v1/calendar/day/20270101?level=year", "GET"],
				["fetch", "/api/v1/calendar/day/20270101/ensure?level=year", "POST"],
				["notify", "No calendar page for 2027 yet", "info"],
			],
			week: [
				["commitEdit"],
				["fetch", "/api/v1/calendar/day/20261011?level=week", "GET"],
				["fetch", "/api/v1/calendar/day/20261011/ensure?level=week", "POST"],
				["notify", "No calendar page for the week of 2026-10-11 yet", "info"],
			],
		});
	});
});
