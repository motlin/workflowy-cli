import {describe, expect, it, vi} from "vite-plus/test";
import {
	BROWSER_NATIVE_COMMANDS,
	deferToFocusedControl,
	hotkeyTable,
	keymapCombo,
	processAppMessageCombo,
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

	it("executes save_and_sync once on meta+s and claims the combo", () => {
		const execute = vi.fn<(ctx: CommandContext) => void>();
		expect({
			result: processCombo("meta+s", {save_and_sync: {execute}}, ctx, true),
			calls: execute.mock.calls,
		}).toStrictEqual({result: "claimed", calls: [[ctx]]});
	});

	it("leaves an unbound combo to the browser", () => {
		expect(processCombo("meta+q", {}, ctx, true)).toBe("unclaimed");
	});

	it("dispatches the local history bindings upstream only has in Electron", () => {
		const back = vi.fn<(ctx: CommandContext) => void>();
		const forward = vi.fn<(ctx: CommandContext) => void>();
		const registry = {
			navigate_backward: {execute: back},
			navigate_forward: {execute: forward},
		};
		expect({
			results: ["meta+[", "meta+]"].map((combo) => processCombo(combo, registry, ctx, true)),
			calls: [back.mock.calls.length, forward.mock.calls.length],
		}).toStrictEqual({results: ["claimed", "claimed"], calls: [1, 1]});
	});

	it("toggles the right bar on meta+/ only, leaving meta+shift+/ to the browser", () => {
		const toggle = vi.fn<(ctx: CommandContext) => void>();
		const registry = {toggle_rightbar: {execute: toggle}};
		expect({
			results: ["meta+/", "meta+shift+/"].map((combo) => processCombo(combo, registry, ctx, true)),
			calls: toggle.mock.calls,
		}).toStrictEqual({results: ["claimed", "unclaimed"], calls: [[ctx]]});
	});

	it("toggles the left bar on ⌃L on mac and ⌥L elsewhere, leaving ctrl+l off mac to the browser", () => {
		const toggle = vi.fn<(ctx: CommandContext) => void>();
		const registry = {toggle_leftbar: {execute: toggle}};
		const key = {which: 76, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false};
		const dispatch = (event: typeof key, isMac: boolean) => {
			const combo = keymapCombo(event, isMac);
			return combo === null ? null : processCombo(combo, registry, ctx, isMac);
		};
		expect({
			macCtrl: dispatch({...key, ctrlKey: true}, true),
			otherAlt: dispatch({...key, altKey: true}, false),
			otherCtrl: dispatch({...key, ctrlKey: true}, false),
			calls: toggle.mock.calls,
		}).toStrictEqual({macCtrl: "claimed", otherAlt: "claimed", otherCtrl: "unclaimed", calls: [[ctx], [ctx]]});
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
			help: table.get("meta+/"),
			shiftHelp: table.get("meta+shift+/"),
			quit: table.get("meta+q"),
		}).toStrictEqual({
			save: "save_and_sync",
			zoomIn: "zoom_in",
			today: "navigate_to_today",
			back: "navigate_backward",
			forward: "navigate_forward",
			help: "toggle_rightbar",
			shiftHelp: undefined,
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
			escape: keymapCombo({...event, which: 27}, true),
			selectUp: keymapCombo({...event, which: 38, shiftKey: true}, true),
			zoomIn: keymapCombo({...event, which: 190, metaKey: true}, true),
		}).toStrictEqual({escape: null, selectUp: null, zoomIn: "meta+."});
	});

	it("dispatches ⌘Home / ⌘End to focus_first / focus_last", () => {
		expect({
			home: keymapCombo({...event, which: 36, metaKey: true}, true),
			end: keymapCombo({...event, which: 35, metaKey: true}, true),
		}).toStrictEqual({home: "meta+home", end: "meta+end"});
	});

	it("dispatches undo and redo combos from the outline", () => {
		expect({
			undo: keymapCombo({...event, which: 90, metaKey: true}, true),
			redo: keymapCombo({...event, which: 90, metaKey: true, shiftKey: true}, true),
			redoY: keymapCombo({...event, which: 89, metaKey: true}, true),
			undoCtrl: keymapCombo({...event, which: 90, ctrlKey: true}, false),
			redoCtrl: keymapCombo({...event, which: 90, ctrlKey: true, shiftKey: true}, false),
		}).toStrictEqual({
			undo: "meta+z",
			redo: "meta+shift+z",
			redoY: "meta+y",
			undoCtrl: "ctrl+z",
			redoCtrl: "ctrl+shift+z",
		});
	});

	it("leaves undo and redo to a focused form field but dispatches its other combos", () => {
		expect({
			undo: keymapCombo({...event, which: 90, metaKey: true}, true, true),
			redo: keymapCombo({...event, which: 90, metaKey: true, shiftKey: true}, true, true),
			zoomIn: keymapCombo({...event, which: 190, metaKey: true}, true, true),
		}).toStrictEqual({undo: null, redo: null, zoomIn: "meta+."});
	});

	it("executes undo on meta+z and redo on meta+shift+z", () => {
		const undo = vi.fn<(ctx: CommandContext) => void>();
		const redo = vi.fn<(ctx: CommandContext) => void>();
		const registry = {undo: {execute: undo}, redo: {execute: redo}};
		expect({
			results: ["meta+z", "meta+shift+z", "meta+y"].map((combo) => processCombo(combo, registry, ctx, true)),
			calls: [undo.mock.calls.length, redo.mock.calls.length],
		}).toStrictEqual({results: ["claimed", "claimed", "claimed"], calls: [1, 2]});
	});

	it("lists the commands the local app leaves to the browser", () => {
		expect([...BROWSER_NATIVE_COMMANDS]).toStrictEqual([
			"select_all",
			"expand_selection_up",
			"expand_selection_down",
			"focus_or_unfocus_search",
		]);
	});
});

describe("processAppMessageCombo", () => {
	it("runs the shown message's action bound to the combo once and claims it", () => {
		const view = vi.fn<() => void>();
		const undo = vi.fn<() => void>();
		expect({
			result: processAppMessageCombo("shift+return", [
				{label: "View", shortcut: "shift+return", run: view},
				{label: "Undo", run: undo},
			]),
			view: view.mock.calls,
			undo: undo.mock.calls,
		}).toStrictEqual({result: "claimed", view: [[]], undo: []});
	});

	it("leaves a combo no action binds to the keymap", () => {
		const view = vi.fn<() => void>();
		expect({
			result: processAppMessageCombo("return", [{label: "View", shortcut: "shift+return", run: view}]),
			view: view.mock.calls,
		}).toStrictEqual({result: "unclaimed", view: []});
	});
});
