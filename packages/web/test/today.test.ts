import {describe, expect, it} from "vite-plus/test";
import {navigateToToday} from "../src/client/today.js";

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
			navigate: (path: string) => {
				calls.push(["navigate", path]);
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
			["navigate", "/#/day000000001"],
		]);
	});

	it("edits the found day's first child", async () => {
		const {calls, deps} = harness([{status: 200, body: {id: "day000000001", firstChildId: "kid000000001"}}]);
		await navigateToToday(deps);
		expect(calls).toStrictEqual([
			["commitEdit"],
			["fetch", "/api/v1/calendar/day/20261017", "GET"],
			["navigate", "/#/day000000001"],
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
			["navigate", "/#/day000000002"],
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
