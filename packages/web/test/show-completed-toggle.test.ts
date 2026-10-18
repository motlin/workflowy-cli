import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {runShowCompletedToggle} from "../src/client/show-completed-toggle.js";
import type {ShowCompletedToggleInput} from "../src/client/show-completed-toggle.js";

type Call = [string, ...unknown[]];

function harness(
	input: Pick<ShowCompletedToggleInput, "showCompleted" | "editingId"> & {
		shown: string[];
		hidden: string[];
		completed: string[];
	},
): {input: ShowCompletedToggleInput; calls: Call[]} {
	const calls: Call[] = [];
	const record =
		(name: string) =>
		(...args: unknown[]): void => {
			calls.push([name, ...args]);
		};
	return {
		calls,
		input: {
			showCompleted: input.showCompleted,
			editingId: input.editingId,
			rowsFor: (showCompleted) => (showCompleted ? input.shown : input.hidden),
			isCompleted: (id) => input.completed.includes(id),
			actions: {
				setShowCompleted: record("setShowCompleted"),
				beginCompletionAnimation: record("beginCompletionAnimation"),
				startCompletionSlideUp: record("startCompletionSlideUp"),
				endCompletionAnimation: record("endCompletionAnimation"),
				startCompletedSlideDown: record("startCompletedSlideDown"),
				endCompletedSlideDown: record("endCompletedSlideDown"),
				resumeEditing: record("resumeEditing"),
			},
		},
	};
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("runShowCompletedToggle", () => {
	it("hides: slides up the hidden done rows, moves the caret off a hidden row, then ends the slide", () => {
		const {input, calls} = harness({
			showCompleted: true,
			editingId: "b-child",
			shown: ["zoom", "a", "b", "b-child", "c"],
			hidden: ["zoom", "a", "c"],
			completed: ["b"],
		});
		runShowCompletedToggle(input);
		const beforeTimer = [...calls];
		vi.advanceTimersByTime(220);
		expect({beforeTimer, after: calls.slice(beforeTimer.length)}).toStrictEqual({
			beforeTimer: [
				["beginCompletionAnimation", ["b"]],
				["setShowCompleted", false],
				["resumeEditing", "a", 0],
				["startCompletionSlideUp", ["b"]],
			],
			after: [["endCompletionAnimation", ["b"]]],
		});
	});

	it("hides with the caret on a visible row and slides at most 10 rows", () => {
		const done = Array.from({length: 12}, (_, index) => `d${index}`);
		const {input, calls} = harness({
			showCompleted: true,
			editingId: "a",
			shown: ["a", ...done],
			hidden: ["a"],
			completed: done,
		});
		runShowCompletedToggle(input);
		expect(calls).toStrictEqual([
			["beginCompletionAnimation", done.slice(0, 10)],
			["setShowCompleted", false],
			["startCompletionSlideUp", done.slice(0, 10)],
		]);
	});

	it("shows: reveals the rows, then slides down the newly visible done rows", () => {
		const {input, calls} = harness({
			showCompleted: false,
			editingId: null,
			shown: ["a", "b", "b-child", "c"],
			hidden: ["a", "c"],
			completed: ["b"],
		});
		runShowCompletedToggle(input);
		const beforeTimer = [...calls];
		vi.advanceTimersByTime(220);
		expect({beforeTimer, after: calls.slice(beforeTimer.length)}).toStrictEqual({
			beforeTimer: [
				["setShowCompleted", true],
				["startCompletedSlideDown", ["b"]],
			],
			after: [["endCompletedSlideDown", ["b"]]],
		});
	});
});
