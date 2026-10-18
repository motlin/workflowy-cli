import {describe, expect, it, vi} from "vite-plus/test";
import {Hono} from "hono";
import {CalendarRootMissing} from "@workflowy/shared/internal";
import type {WorkflowyInternalAdapter} from "@workflowy/shared/internal";
import type {AppEnv, ServerContext} from "../src/server/context.js";
import {createCalendarRouter} from "../src/server/routes/calendar.js";

const NOT_CONFIGURED =
	"Workflowy internal API is not configured (set WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD, or run './bin/run.js internal login')";
const ENSURED = {dayId: "day", firstChildId: "child", created: ["month", "day", "child"]};

function setup(options: {configured?: boolean; ensure?: WorkflowyInternalAdapter["ensureCalendarDay"]} = {}) {
	const configured = options.configured ?? true;
	const adapter = {
		ensureCalendarDay: vi.fn<WorkflowyInternalAdapter["ensureCalendarDay"]>(
			options.ensure ?? (async () => Promise.resolve(ENSURED)),
		),
	};
	const ctx = {
		apiKey: configured ? "key" : undefined,
		internalAdapter: () => (configured ? (adapter as unknown as WorkflowyInternalAdapter) : undefined),
	} as unknown as ServerContext;
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => {
		c.set("ctx", ctx);
		await next();
	});
	app.route("/api/v1/calendar", createCalendarRouter());
	const ensure = async (dateId: string) => {
		const res = await app.fetch(new Request(`http://x/api/v1/calendar/day/${dateId}/ensure`, {method: "POST"}));
		return {status: res.status, body: (await res.json()) as unknown};
	};
	return {adapter, ensure};
}

describe("POST /api/v1/calendar/day/:dateId/ensure", () => {
	it("ensures the day through the adapter and returns its ids", async () => {
		const {adapter, ensure} = setup();

		const response = await ensure("20261017");

		expect({response, calls: adapter.ensureCalendarDay.mock.calls}).toStrictEqual({
			response: {status: 200, body: ENSURED},
			calls: [[20_261_017]],
		});
	});

	it("rejects a dateId that is not a real YYYYMMDD day", async () => {
		const {adapter, ensure} = setup();

		const responses = [await ensure("20260230"), await ensure("2026-10-17"), await ensure("202610170")];

		expect({responses, calls: adapter.ensureCalendarDay.mock.calls}).toStrictEqual({
			responses: Array.from({length: 3}, () => ({
				status: 400,
				body: {error: "dateId must be a YYYYMMDD calendar day"},
			})),
			calls: [],
		});
	});

	it("answers 409 when no calendar root is cached", async () => {
		const {ensure} = setup({ensure: async () => Promise.reject(new CalendarRootMissing())});

		await expect(ensure("20261017")).resolves.toStrictEqual({
			status: 409,
			body: {error: new CalendarRootMissing().message},
		});
	});

	it("answers 503 without the internal API", async () => {
		const {ensure} = setup({configured: false});

		await expect(ensure("20261017")).resolves.toStrictEqual({status: 503, body: {error: NOT_CONFIGURED}});
	});
});
