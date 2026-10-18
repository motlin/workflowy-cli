import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {zoomToToday} from "../src/client/zoom-to-today.js";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("zoomToToday", () => {
	it("navigates to the first search result for today's date", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async () => Promise.resolve(Response.json({results: [{id: "d1", name: "Today"}]}))),
		);
		const navigate = vi.fn<(path: string) => void>();
		await zoomToToday({navigate});
		expect(navigate.mock.calls).toStrictEqual([["/node/d1"]]);
	});
});
