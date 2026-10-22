// @vitest-environment happy-dom
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {goToNode, zoomToCachedLocation} from "../src/client/navigation.js";
import {useOutlineStore} from "../src/client/stores/outline.js";
import {focusScrolls} from "../src/client/quiet-focus.js";

const ALICE = "4823cefa-5fc0-478c-88ac-aaaaaaaaaaaa";
const BOB = "9a1f6c2e-0b7d-4e5a-8c3f-bbbbbbbbbbbb";

let frames: FrameRequestCallback[] = [];

beforeEach(() => {
	useOutlineStore.setState(useOutlineStore.getInitialState(), true);
	frames = [];
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
});

afterEach(() => {
	vi.unstubAllGlobals();
});

async function paint(): Promise<void> {
	for (const frame of frames.splice(0)) {
		frame(0);
	}
	await new Promise((resolve) => {
		setTimeout(resolve, 5);
	});
}

describe("navigation while editing", () => {
	it("goToNode swaps with no row editing and resumes the edited row after the paint", async () => {
		useOutlineStore.getState().resumeEditing(BOB, 3);
		goToNode(() => {}, ALICE);
		const atSwap = useOutlineStore.getState().editingId;
		await paint();
		const {editingId, editingCaretOffset} = useOutlineStore.getState();
		expect({atSwap, editingId, editingCaretOffset}).toStrictEqual({
			atSwap: null,
			editingId: BOB,
			editingCaretOffset: 3,
		});
	});

	it("Back zooms from the popstate with no row editing and resumes the edited row after the paint", async () => {
		useOutlineStore.getState().resumeEditing(BOB, 2);
		zoomToCachedLocation("#/aaaaaaaaaaaa", (id) => (id === "aaaaaaaaaaaa" ? ALICE : undefined));
		const atSwap = useOutlineStore.getState().editingId;
		await paint();
		expect({atSwap, editingId: useOutlineStore.getState().editingId}).toStrictEqual({atSwap: null, editingId: BOB});
	});

	it("resumes the edited row after a swap without scrolling to it, as upstream keeps the restored scroll", async () => {
		useOutlineStore.getState().resumeEditing(BOB, 2);
		zoomToCachedLocation("#/aaaaaaaaaaaa", (id) => (id === "aaaaaaaaaaaa" ? ALICE : undefined));
		await paint();
		expect({resumed: focusScrolls(BOB), later: focusScrolls(BOB)}).toStrictEqual({resumed: false, later: true});
	});
});
