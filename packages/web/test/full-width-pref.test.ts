import {describe, expect, it} from "vite-plus/test";
import {FULL_WIDTH_STORAGE_KEY, readFullWidthPref, writeFullWidthPref} from "../src/client/full-width-pref.js";

const storageWith = (value: string | null) => ({getItem: () => value});

describe("full width page preference", () => {
	it("defaults to on, like the account it mirrors", () => {
		expect(readFullWidthPref(storageWith(null))).toBe(true);
	});

	it("reads the stored value", () => {
		expect([readFullWidthPref(storageWith("true")), readFullWidthPref(storageWith("false"))]).toStrictEqual([
			true,
			false,
		]);
	});

	it("falls back to on when storage throws", () => {
		expect(
			readFullWidthPref({
				getItem: () => {
					throw new Error("blocked");
				},
			}),
		).toBe(true);
	});

	it("writes 'false' under workflowy-full-width-page", () => {
		const written: [string, string][] = [];
		writeFullWidthPref({setItem: (key, value) => void written.push([key, value])}, false);
		expect([FULL_WIDTH_STORAGE_KEY, written]).toStrictEqual([
			"workflowy-full-width-page",
			[["workflowy-full-width-page", "false"]],
		]);
	});
});
