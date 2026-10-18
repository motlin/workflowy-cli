import {describe, expect, it} from "vite-plus/test";
import {nodeUrl, resolveZoomTarget} from "../src/client/navigation.js";

const FULL_ID = "4823cefa-5fc0-478c-88ac-35035d443bf1";

describe("resolveZoomTarget", () => {
	const lookup = (id: string) => (id === "35035d443bf1" ? FULL_ID : null);

	it("treats a missing id as home", () => {
		expect(resolveZoomTarget(null, lookup)).toBe("home");
	});

	it("returns a full uuid as is", () => {
		expect(resolveZoomTarget(FULL_ID, () => null)).toBe(FULL_ID);
	});

	it("resolves a 12-hex short id through the lookup", () => {
		expect(resolveZoomTarget("35035d443bf1", lookup)).toBe(FULL_ID);
	});

	it("returns null for an unknown short id", () => {
		expect(resolveZoomTarget("ffffffffffff", lookup)).toBeNull();
	});
});

describe("nodeUrl", () => {
	it("routes to the upstream short-id hash URL", () => {
		expect(nodeUrl(FULL_ID)).toBe("/#/35035d443bf1");
	});
});
