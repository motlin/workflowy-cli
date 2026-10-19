import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";

function stripPaths(markup: string): string {
	return markup.replaceAll(/ d="[^"]*"/gu, ' d=""');
}

const CHECK_ICON =
	'<div class="h-full flex items-center"><svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="circle-check" class="svg-inline--fa fa-circle-check fa-lg text-success" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d=""></path></svg></div>';
const CLOSE =
	'<div class="h-full flex items-center"><span class="p-s cursor-pointer text-tertiary"><svg aria-hidden="true" focusable="false" data-prefix="fal" data-icon="xmark" class="svg-inline--fa fa-xmark fa-1x " role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><path fill="currentColor" d=""></path></svg></span></div>';
const OPEN =
	'<div class="flex justify-center fixed left-0 right-0 leading-xs" style="z-index:500;bottom:calc(72px + var(--safe-area-inset-bottom))"><div class="flex flex-row max-w-[90vw] gap-ml px-m shadow-sm bg-primary border border-solid border-primary rounded-s">';

function stubGlobals(): void {
	vi.stubGlobal("localStorage", {getItem: () => null, setItem: () => {}, removeItem: () => {}});
	vi.stubGlobal("innerWidth", 1272);
	vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: () => {}}));
	vi.stubGlobal("document", {documentElement: {dataset: {}}, body: {classList: {toggle: () => true}}});
	vi.stubGlobal("addEventListener", () => {});
}

async function loadStore() {
	vi.resetModules();
	stubGlobals();
	const {useOutlineStore} = await import("../src/client/stores/outline.js");
	return useOutlineStore;
}

async function loadAppMessage() {
	stubGlobals();
	const {AppMessage} = await import("../src/client/components/app-message.js");
	return AppMessage;
}

describe("AppMessage markup", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("renders upstream's success toast", async () => {
		const AppMessage = await loadAppMessage();
		expect(stripPaths(renderToStaticMarkup(createElement(AppMessage, {text: "Link copied."})))).toBe(
			`${OPEN}${CHECK_ICON}<div class="flex-1 min-w-0 py-m truncate first-letter:capitalize text-secondary font-light">Link copied.</div>${CLOSE}</div></div>`,
		);
	});

	it("renders action buttons between the text and the close button", async () => {
		const AppMessage = await loadAppMessage();
		expect(
			stripPaths(
				renderToStaticMarkup(
					createElement(AppMessage, {
						text: "Moved to",
						actions: [
							{label: "View", shortcut: "shift+return", run: () => {}},
							{label: "Undo", run: () => {}},
						],
					}),
				),
			),
		).toBe(
			`${OPEN}${CHECK_ICON}<div class="flex-1 min-w-0 py-m truncate first-letter:capitalize text-secondary font-light">Moved to</div>` +
				'<div class="flex items-center text-primary content-end font-medium desktop:hover:underline cursor-pointer" style="height:100%"><div class="flex items-baseline"><span class="">View</span><span class="mobile:hidden text-s text-tertiary font-normal ml-xs">(shift+return)</span></div></div>' +
				'<div class="flex items-center text-primary content-end font-medium desktop:hover:underline cursor-pointer" style="height:100%"><div class="flex items-baseline"><span class="">Undo</span></div></div>' +
				`${CLOSE}</div></div>`,
		);
	});
});

describe("showAppMessage", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("shows the message and clears it after the timeout", async () => {
		const store = await loadStore();
		store.getState().showAppMessage("x", {timeout: 1000});
		expect(store.getState().appMessage).toStrictEqual({text: "x", actions: []});
		vi.advanceTimersByTime(999);
		expect(store.getState().appMessage).toStrictEqual({text: "x", actions: []});
		vi.advanceTimersByTime(1);
		expect(store.getState().appMessage).toBeNull();
	});

	it("replaces the current message and drops its pending timeout", async () => {
		const store = await loadStore();
		const undo = {label: "Undo", run: () => {}};
		store.getState().showAppMessage("first", {timeout: 1000});
		vi.advanceTimersByTime(500);
		store.getState().showAppMessage("Sorted A-Z", {timeout: 5000, actions: [undo]});
		vi.advanceTimersByTime(4999);
		expect(store.getState().appMessage).toStrictEqual({text: "Sorted A-Z", actions: [undo]});
		vi.advanceTimersByTime(1);
		expect(store.getState().appMessage).toBeNull();
	});

	it("stays until hidden when no timeout is given", async () => {
		const store = await loadStore();
		store.getState().showAppMessage("sticky");
		vi.advanceTimersByTime(60_000);
		expect(store.getState().appMessage).toStrictEqual({text: "sticky", actions: []});
		store.getState().hideAppMessage();
		expect(store.getState().appMessage).toBeNull();
	});
});
