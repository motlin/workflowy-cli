// @vitest-environment happy-dom
import {afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";
import type {Root} from "react-dom/client";
import type {DecisionPage} from "../src/server/decisions.js";

declare global {
	// React reads this to know act() wraps every update.
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const {hideLoadingScreenOnce} = vi.hoisted(() => ({hideLoadingScreenOnce: vi.fn<() => void>()}));
vi.mock("../src/client/loading-screen.js", () => ({hideLoadingScreenOnce}));

const {act, createElement} = await import("react");
const {createRoot} = await import("react-dom/client");
const {DecisionPageView} = await import("../src/client/components/decisions-view.js");

const PAGE: DecisionPage = {
	slug: "meetings",
	title: "Meeting follow-ups",
	intro: "Pick one per item",
	groups: [
		{
			heading: "1:1 Alice - Mon Oct 26",
			link: "https://example.com/meeting",
			items: [
				{
					id: "a-1",
					title: "Send the deck",
					body: ["Alice asked for the deck", "<b>not html</b>"],
					links: [{label: "Meeting", href: "https://example.com/meeting"}],
					options: [
						{value: "inbox", label: "Add to inbox", description: "File it"},
						{value: "skip", label: "Skip"},
					],
					default: "inbox",
					answer: null,
				},
				{
					id: "a-2",
					title: "Book the room",
					body: [],
					links: [],
					options: [{value: "skip", label: "Skip"}],
					default: null,
					answer: {choice: "skip", note: "", answeredAt: "2026-10-27T14:00:00.000Z"},
				},
			],
		},
	],
	submittedAt: null,
};

interface Call {
	method: string;
	url: string;
	body: unknown;
}

let root: Root | undefined;
let host: HTMLElement | undefined;
let calls: Call[] = [];

beforeAll(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	await act(async () => {
		root?.unmount();
		await Promise.resolve();
	});
	host?.remove();
	calls = [];
});

/** Stub fetch: GET answers the page, writes answer `write(call)` (default: echo a saved answer). */
function stubFetch(write: (call: Call) => Response = defaultWrite): void {
	vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
		const method = init.method ?? "GET";
		const call = {method, url, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined};
		calls.push(call);
		return Promise.resolve(method === "GET" ? Response.json(PAGE) : write(call));
	});
}

function defaultWrite(call: Call): Response {
	return call.method === "POST"
		? Response.json({submittedAt: "2026-10-27T15:00:00.000Z"})
		: Response.json({answer: {...(call.body as object), answeredAt: "2026-10-27T15:00:00.000Z"}});
}

async function flush(): Promise<void> {
	await act(async () => {
		for (let index = 0; index < 5; index++) {
			await Promise.resolve();
		}
	});
}

async function mount(): Promise<void> {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => {
		root?.render(createElement(DecisionPageView, {slug: "meetings"}));
		await Promise.resolve();
	});
	await flush();
}

function card(id: string): HTMLElement {
	const element = host?.querySelector<HTMLElement>(`[data-item-id="${id}"]`);
	if (!element) {
		throw new Error(`no card ${id}`);
	}
	return element;
}

function text(selector: string, within: ParentNode | undefined = host): string[] {
	return [...(within?.querySelectorAll(selector) ?? [])].map((element) => element.textContent);
}

describe("DecisionPageView", () => {
	it("retries the page load through a dev API restart instead of showing a JSON parse error", async () => {
		let gets = 0;
		vi.stubGlobal("fetch", async () => {
			gets++;
			return Promise.resolve(gets === 1 ? new Response("", {status: 200}) : Response.json(PAGE));
		});
		await mount();
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 400);
			});
		});
		await flush();
		expect({gets, title: text("h1"), errors: text("[role=alert]")}).toStrictEqual({
			gets: 2,
			title: ["Meeting follow-ups"],
			errors: [],
		});
	});

	it("dismisses the boot loading screen, which only the outline view hid before", async () => {
		hideLoadingScreenOnce.mockClear();
		stubFetch();
		await mount();
		expect(hideLoadingScreenOnce.mock.calls).toStrictEqual([[]]);
	});

	it("renders the staged page with body lines as text, links in new tabs and one radio per option", async () => {
		stubFetch();
		await mount();
		const first = card("a-1");
		expect({
			title: text("h1"),
			intro: text(".decisions-intro"),
			heading: text(".decisions-group-heading"),
			headingLink: host?.querySelector(".decisions-group-heading a")?.getAttribute("href"),
			cardTitle: text("h3", first),
			body: text(".decisions-body-line", first),
			bodyHtmlElements: first.querySelectorAll(".decisions-body-line b").length,
			links: [...first.querySelectorAll(".decisions-links a")].map((link) => [
				link.textContent,
				link.getAttribute("href"),
				link.getAttribute("target"),
				link.getAttribute("rel"),
			]),
			radios: [...first.querySelectorAll<HTMLInputElement>("input[type=radio]")].map((radio) => [
				radio.value,
				radio.checked,
			]),
			optionLabels: text(".decisions-option-label", first),
			optionDescriptions: text(".decisions-option-description", first),
			suggested: text(".decisions-suggested", first),
			answeredRadio: card("a-2").querySelector<HTMLInputElement>("input[value=skip]")?.checked,
			footer: text(".decisions-progress"),
			calls,
		}).toStrictEqual({
			title: ["Meeting follow-ups"],
			intro: ["Pick one per item"],
			heading: ["1:1 Alice - Mon Oct 26"],
			headingLink: "https://example.com/meeting",
			cardTitle: ["Send the deck"],
			body: ["Alice asked for the deck", "<b>not html</b>"],
			bodyHtmlElements: 0,
			links: [["Meeting", "https://example.com/meeting", "_blank", "noopener noreferrer"]],
			radios: [
				["inbox", false],
				["skip", false],
			],
			optionLabels: ["Add to inbox", "Skip"],
			optionDescriptions: ["File it"],
			suggested: ["suggested"],
			answeredRadio: true,
			footer: ["1 of 2 answered"],
			calls: [{method: "GET", url: "/api/v1/decisions/meetings", body: undefined}],
		});
	});

	it("saves a radio choice immediately and shows it saved", async () => {
		stubFetch();
		await mount();
		await act(async () => {
			card("a-1").querySelector<HTMLInputElement>("input[value=inbox]")?.click();
			await Promise.resolve();
		});
		await flush();
		expect({
			calls: calls.slice(1),
			status: text(".decisions-status", card("a-1")),
			footer: text(".decisions-progress"),
		}).toStrictEqual({
			calls: [{method: "PUT", url: "/api/v1/decisions/meetings/a-1", body: {choice: "inbox", note: ""}}],
			status: ["Saved"],
			footer: ["2 of 2 answered"],
		});
	});

	it("debounces the note and saves it with the current choice", async () => {
		vi.useFakeTimers();
		stubFetch();
		await mount();
		const textarea = card("a-2").querySelector("textarea")!;
		for (const value of ["l", "la", "later"]) {
			await act(async () => {
				Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, value);
				textarea.dispatchEvent(new Event("input", {bubbles: true}));
				await Promise.resolve();
			});
		}
		expect(calls.slice(1)).toStrictEqual([]);
		await act(async () => {
			vi.advanceTimersByTime(700);
			await Promise.resolve();
		});
		await flush();
		expect(calls.slice(1)).toStrictEqual([
			{method: "PUT", url: "/api/v1/decisions/meetings/a-2", body: {choice: "skip", note: "later"}},
		]);
	});

	it("shows the server's error on the card when a save fails", async () => {
		stubFetch(() => Response.json({error: 'Choice "inbox" is not an option for item "a-1"'}, {status: 400}));
		await mount();
		await act(async () => {
			card("a-1").querySelector<HTMLInputElement>("input[value=inbox]")?.click();
			await Promise.resolve();
		});
		await flush();
		expect(text(".decisions-status", card("a-1"))).toStrictEqual([
			'Not saved: Choice "inbox" is not an option for item "a-1"',
		]);
	});

	it("submits the page and confirms", async () => {
		stubFetch();
		await mount();
		await act(async () => {
			host?.querySelector<HTMLButtonElement>(".decisions-submit")?.click();
			await Promise.resolve();
		});
		await flush();
		expect({
			calls: calls.slice(1),
			confirmation: text(".decisions-submitted"),
		}).toStrictEqual({
			calls: [{method: "POST", url: "/api/v1/decisions/meetings/submit", body: undefined}],
			confirmation: ["Submitted. Tell Claude you're done."],
		});
	});

	it("shows why the page could not load", async () => {
		vi.stubGlobal("fetch", async () =>
			Promise.resolve(Response.json({error: "No decision page staged as meetings"}, {status: 404})),
		);
		await mount();
		expect(text(".decisions-error")).toStrictEqual(["No decision page staged as meetings"]);
	});
});
