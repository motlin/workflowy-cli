import {describe, expect, it, vi} from "vite-plus/test";
import {
	BROWSER_NATIVE_COMMANDS,
	deferToFocusedControl,
	hotkeyTable,
	keymapCombo,
	processCombo,
} from "../src/client/keys/dispatch.js";
import type {CommandContext} from "../src/client/keys/dispatch.js";

const ctx: CommandContext = {items: ["a"], zoomedId: null};

describe("processCombo", () => {
	it("claims a bound combo with no registered command, so the browser never acts on it", () => {
		expect(processCombo("meta+s", {}, ctx, true)).toBe("claimed");
	});

	it("leaves an unavailable passthrough combo to the browser without executing it", () => {
		const execute = vi.fn<(ctx: CommandContext) => void>();
		expect({
			result: processCombo("alt+;", {teleport: {available: () => false, execute}}, ctx, true),
			calls: execute.mock.calls,
		}).toStrictEqual({result: "unclaimed", calls: []});
	});

	it("leaves ctrl+t to the browser on mac when nothing handles it", () => {
		expect(processCombo("ctrl+t", {}, ctx, true)).toBe("unclaimed");
	});

	it("claims ctrl+t off mac even when nothing handles it", () => {
		expect(processCombo("alt+t", {}, ctx, false)).toBe("claimed");
	});

	it("executes an available command once with the context and claims the combo", () => {
		const execute = vi.fn<(ctx: CommandContext) => void>();
		expect({
			result: processCombo("meta+.", {zoom_in: {execute}}, ctx, true),
			calls: execute.mock.calls,
		}).toStrictEqual({result: "claimed", calls: [[ctx]]});
	});

	it("claims an unavailable command outside the passthrough set without executing it", () => {
		const execute = vi.fn<(ctx: CommandContext) => void>();
		expect({
			result: processCombo("meta+s", {save_and_sync: {available: () => false, execute}}, ctx, true),
			calls: execute.mock.calls,
		}).toStrictEqual({result: "claimed", calls: []});
	});

	it("leaves an unbound combo to the browser", () => {
		expect(processCombo("meta+q", {}, ctx, true)).toBe("unclaimed");
	});

	it("dispatches the local history and help bindings upstream only has in Electron", () => {
		const back = vi.fn<(ctx: CommandContext) => void>();
		const forward = vi.fn<(ctx: CommandContext) => void>();
		const help = vi.fn<(ctx: CommandContext) => void>();
		const registry = {
			navigate_backward: {execute: back},
			navigate_forward: {execute: forward},
			toggle_rightbar: {execute: help},
		};
		expect({
			results: ["meta+[", "meta+]", "meta+shift+/"].map((combo) => processCombo(combo, registry, ctx, true)),
			calls: [back.mock.calls.length, forward.mock.calls.length, help.mock.calls.length],
		}).toStrictEqual({results: ["claimed", "claimed", "claimed"], calls: [1, 1, 1]});
	});
});

describe("hotkeyTable", () => {
	it("maps the platform's upstream combos plus the local extras", () => {
		const table = hotkeyTable(true);
		expect({
			save: table.get("meta+s"),
			zoomIn: table.get("meta+."),
			today: table.get("ctrl+t"),
			back: table.get("meta+["),
			forward: table.get("meta+]"),
			help: table.get("meta+shift+/"),
			quit: table.get("meta+q"),
		}).toStrictEqual({
			save: "save_and_sync",
			zoomIn: "zoom_in",
			today: "navigate_to_today",
			back: "navigate_backward",
			forward: "navigate_forward",
			help: "toggle_rightbar",
			quit: undefined,
		});
	});

	it("binds the off-mac upstream combos", () => {
		const table = hotkeyTable(false);
		expect({
			complete: table.get("ctrl+return"),
			today: table.get("alt+t"),
			macComplete: table.get("meta+return"),
		}).toStrictEqual({complete: "complete", today: "navigate_to_today", macComplete: undefined});
	});
});

describe("deferToFocusedControl", () => {
	const control = (tabIndex: number, inName: boolean) => ({
		tabIndex,
		closest: (selector: string) => (selector === ".name" && inName ? {} : null),
	});

	it("lets a focused button or input keep tab, select-all and return", () => {
		expect(
			["tab", "shift+tab", "meta+a", "ctrl+a", "return"].map((combo) =>
				deferToFocusedControl(combo, control(0, false)),
			),
		).toStrictEqual([true, true, true, true, true]);
	});

	it("keeps dispatching from the outline's editable text", () => {
		expect(deferToFocusedControl("tab", control(0, true))).toBe(false);
	});

	it("keeps dispatching from elements outside the tab order and for other combos", () => {
		expect({
			unfocusable: deferToFocusedControl("tab", control(-1, false)),
			otherCombo: deferToFocusedControl("meta+s", control(0, false)),
			nothingFocused: deferToFocusedControl("tab", null),
		}).toStrictEqual({unfocusable: false, otherCombo: false, nothingFocused: false});
	});
});

describe("keymapCombo", () => {
	const event = {which: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false};

	it("skips combos whose commands the browser or the editor still own", () => {
		expect({
			undo: keymapCombo({...event, which: 90, metaKey: true}, true),
			escape: keymapCombo({...event, which: 27}, true),
			selectUp: keymapCombo({...event, which: 38, shiftKey: true}, true),
			zoomIn: keymapCombo({...event, which: 190, metaKey: true}, true),
		}).toStrictEqual({undo: null, escape: null, selectUp: null, zoomIn: "meta+."});
	});

	it("lists the commands the local app leaves to the browser", () => {
		expect([...BROWSER_NATIVE_COMMANDS]).toStrictEqual([
			"undo",
			"redo",
			"select_all",
			"expand_selection_up",
			"expand_selection_down",
			"focus_first",
			"focus_last",
			"focus_or_unfocus_search",
		]);
	});
});
