import {describe, expect, it} from "vite-plus/test";
import {paneResizeHandlers} from "../src/client/pane-resize.js";

function pointer(clientX: number, log: string[]) {
	return {
		clientX,
		pointerId: 7,
		preventDefault: () => {
			log.push("preventDefault");
		},
		currentTarget: {
			setPointerCapture: (id: number) => {
				log.push(`capture:${id}`);
			},
			releasePointerCapture: (id: number) => {
				log.push(`release:${id}`);
			},
		},
	};
}

describe("paneResizeHandlers", () => {
	it("pins the measured widths on pointerdown, then drags the pane's left divider from them", () => {
		const log: string[] = [];
		const widths: number[][] = [];
		const handlers = paneResizeHandlers(2, {
			measure: () => [400, 500.4, 372],
			setWidths: (next) => {
				widths.push([...next]);
			},
		});
		handlers.onPointerMove(pointer(100, log));
		handlers.onPointerDown(pointer(100, log));
		handlers.onPointerMove(pointer(80, log));
		handlers.onPointerMove(pointer(160, log));
		handlers.onPointerUp(pointer(160, log));
		handlers.onPointerMove(pointer(200, log));
		expect({log, widths}).toStrictEqual({
			log: ["preventDefault", "capture:7", "release:7"],
			widths: [
				[400, 500.4, 372],
				[400, 480.4, 392],
				[400, 522.4, 350],
			],
		});
	});

	it("never resizes the main pane, which has no divider on its left", () => {
		const widths: number[][] = [];
		const handlers = paneResizeHandlers(0, {
			measure: () => [500, 500],
			setWidths: (next) => {
				widths.push([...next]);
			},
		});
		handlers.onPointerDown(pointer(100, []));
		handlers.onPointerMove(pointer(50, []));
		expect(widths).toStrictEqual([[500, 500]]);
	});
});
