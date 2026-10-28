import {describe, expect, it} from "vite-plus/test";
import {Hono} from "hono";
import type {AppEnv, ServerContext} from "../src/server/context.js";
import type {DecisionStore} from "../src/server/decisions.js";
import {createDecisionsApp, createDecisionsRouter} from "../src/server/routes/decisions.js";

const NOW = new Date("2026-10-27T15:00:00.000Z");

const DOCUMENT = {
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
					default: null,
				},
			],
		},
	],
};

/** An in-memory store holding file text by name, the way the filesystem store would. */
function memoryStore(files: Record<string, string>): DecisionStore {
	return {
		readDocument: async (slug) => Promise.resolve(files[`${slug}.json`] ?? null),
		readAnswers: async (slug) => Promise.resolve(files[`${slug}.answers.json`] ?? null),
		writeAnswers: async (slug, text) => {
			files[`${slug}.answers.json`] = text;
			return Promise.resolve();
		},
	};
}

function setup(files: Record<string, string>, options: {withStore: boolean} = {withStore: true}) {
	const ctx = {decisions: options.withStore ? memoryStore(files) : undefined} as unknown as ServerContext;
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => {
		c.set("ctx", ctx);
		await next();
	});
	app.route("/api/v1/decisions", createDecisionsRouter({now: () => NOW}));
	return async (method: string, path: string, body?: unknown) => {
		const res = await app.fetch(
			new Request(`http://x/api/v1/decisions${path}`, {
				method,
				headers: {"content-type": "application/json"},
				...(body === undefined ? {} : {body: JSON.stringify(body)}),
			}),
		);
		return {status: res.status, body: await res.json()};
	};
}

function staged(): Record<string, string> {
	return {"meetings.json": JSON.stringify(DOCUMENT)};
}

describe("GET /api/v1/decisions/:slug", () => {
	it("returns the staged document with no answers yet", async () => {
		const request = setup(staged());
		await expect(request("GET", "/meetings")).resolves.toStrictEqual({
			status: 200,
			body: {
				...DOCUMENT,
				groups: [{...DOCUMENT.groups[0], items: [{...DOCUMENT.groups[0].items[0], answer: null}]}],
				submittedAt: null,
			},
		});
	});

	it("merges saved answers and the submission time into the document", async () => {
		const files: Record<string, string> = {
			...staged(),
			"meetings.answers.json": JSON.stringify({
				"a-1": {choice: "skip", note: "done already", answeredAt: "2026-10-27T14:00:00.000Z"},
				submittedAt: "2026-10-27T14:30:00.000Z",
			}),
		};
		const request = setup(files);
		await expect(request("GET", "/meetings")).resolves.toStrictEqual({
			status: 200,
			body: {
				...DOCUMENT,
				groups: [
					{
						...DOCUMENT.groups[0],
						items: [
							{
								...DOCUMENT.groups[0].items[0],
								answer: {choice: "skip", note: "done already", answeredAt: "2026-10-27T14:00:00.000Z"},
							},
						],
					},
				],
				submittedAt: "2026-10-27T14:30:00.000Z",
			},
		});
	});

	it("answers 404 when nothing is staged under the slug", async () => {
		const request = setup({});
		await expect(request("GET", "/meetings")).resolves.toStrictEqual({
			status: 404,
			body: {error: "No decision page staged as meetings"},
		});
	});

	it("rejects a slug outside [a-z0-9-] before touching the store", async () => {
		const request = setup(staged());
		await expect(request("GET", "/..%2Fsecrets")).resolves.toStrictEqual({
			status: 400,
			body: {error: "Decision slug must match [a-z0-9-]+"},
		});
	});

	it("reports a staged file that is not JSON as a 500 naming the file", async () => {
		const request = setup({"meetings.json": "{oops"});
		await expect(request("GET", "/meetings")).resolves.toStrictEqual({
			status: 500,
			body: {
				error: "meetings.json is not valid JSON: Expected property name or '}' in JSON at position 1 (line 1 column 2)",
			},
		});
	});

	it("reports a staged file with the wrong shape as a 500 naming the bad field", async () => {
		const request = setup({"meetings.json": JSON.stringify({...DOCUMENT, groups: [{heading: "x", items: [{}]}]})});
		await expect(request("GET", "/meetings")).resolves.toStrictEqual({
			status: 500,
			body: {
				error: [
					"meetings.json does not match the decision page shape: ✖ Invalid input: expected string, received undefined",
					"  → at groups[0].items[0].id",
					"✖ Invalid input: expected string, received undefined",
					"  → at groups[0].items[0].title",
					"✖ Invalid input: expected array, received undefined",
					"  → at groups[0].items[0].options",
				].join("\n"),
			},
		});
	});

	it("rejects a staged slug that disagrees with the file name", async () => {
		const request = setup({"meetings.json": JSON.stringify({...DOCUMENT, slug: "other"})});
		await expect(request("GET", "/meetings")).resolves.toStrictEqual({
			status: 500,
			body: {error: 'meetings.json declares slug "other"'},
		});
	});

	it("rejects a staged file whose item ids repeat", async () => {
		const item = DOCUMENT.groups[0].items[0];
		const request = setup({
			"meetings.json": JSON.stringify({...DOCUMENT, groups: [{heading: "x", items: [item, item]}]}),
		});
		await expect(request("GET", "/meetings")).resolves.toStrictEqual({
			status: 500,
			body: {error: 'meetings.json repeats item id "a-1"'},
		});
	});

	it("rejects a default that is not one of the item's options", async () => {
		const item = {...DOCUMENT.groups[0].items[0], default: "later"};
		const request = setup({
			"meetings.json": JSON.stringify({...DOCUMENT, groups: [{heading: "x", items: [item]}]}),
		});
		await expect(request("GET", "/meetings")).resolves.toStrictEqual({
			status: 500,
			body: {error: 'meetings.json item "a-1" defaults to "later", which is not one of its options'},
		});
	});

	it("answers 503 when the host has no decision store", async () => {
		const request = setup({}, {withStore: false});
		await expect(request("GET", "/meetings")).resolves.toStrictEqual({
			status: 503,
			body: {error: "Decision pages are not available on this host"},
		});
	});
});

describe("PUT /api/v1/decisions/:slug/:itemId", () => {
	it("saves the choice and note with the time it was answered", async () => {
		const files: Record<string, string> = staged();
		const request = setup(files);
		await expect(request("PUT", "/meetings/a-1", {choice: "inbox", note: "by Friday"})).resolves.toStrictEqual({
			status: 200,
			body: {answer: {choice: "inbox", note: "by Friday", answeredAt: NOW.toISOString()}},
		});
		expect(JSON.parse(files["meetings.answers.json"])).toStrictEqual({
			"a-1": {choice: "inbox", note: "by Friday", answeredAt: NOW.toISOString()},
		});
	});

	it("keeps other answers and the submission time when one item changes", async () => {
		const files: Record<string, string> = {
			...staged(),
			"meetings.answers.json": JSON.stringify({
				"b-2": {choice: "x", note: "", answeredAt: "2026-10-27T14:00:00.000Z"},
				submittedAt: "2026-10-27T14:30:00.000Z",
			}),
		};
		const request = setup(files);
		await request("PUT", "/meetings/a-1", {choice: null, note: "ask Bob first"});
		expect(JSON.parse(files["meetings.answers.json"])).toStrictEqual({
			"b-2": {choice: "x", note: "", answeredAt: "2026-10-27T14:00:00.000Z"},
			submittedAt: "2026-10-27T14:30:00.000Z",
			"a-1": {choice: null, note: "ask Bob first", answeredAt: NOW.toISOString()},
		});
	});

	it("rejects a choice that is not one of the item's option values", async () => {
		const files: Record<string, string> = staged();
		const request = setup(files);
		await expect(request("PUT", "/meetings/a-1", {choice: "later", note: ""})).resolves.toStrictEqual({
			status: 400,
			body: {error: 'Choice "later" is not an option for item "a-1"'},
		});
		expect(files["meetings.answers.json"]).toBeUndefined();
	});

	it("rejects a body missing the note instead of guessing one", async () => {
		const request = setup(staged());
		await expect(request("PUT", "/meetings/a-1", {choice: "inbox"})).resolves.toStrictEqual({
			status: 400,
			body: {error: "Body must be {choice: string | null, note: string}"},
		});
	});

	it("answers 404 for an item the page does not have", async () => {
		const request = setup(staged());
		await expect(request("PUT", "/meetings/zz-9", {choice: null, note: ""})).resolves.toStrictEqual({
			status: 404,
			body: {error: 'No item "zz-9" on decision page meetings'},
		});
	});

	it("serializes concurrent saves so neither answer is lost", async () => {
		const files: Record<string, string> = {
			"meetings.json": JSON.stringify({
				...DOCUMENT,
				groups: [
					{
						heading: "x",
						items: [DOCUMENT.groups[0].items[0], {...DOCUMENT.groups[0].items[0], id: "a-2"}],
					},
				],
			}),
		};
		const request = setup(files);
		await Promise.all([
			request("PUT", "/meetings/a-1", {choice: "inbox", note: ""}),
			request("PUT", "/meetings/a-2", {choice: "skip", note: ""}),
		]);
		expect(JSON.parse(files["meetings.answers.json"])).toStrictEqual({
			"a-1": {choice: "inbox", note: "", answeredAt: NOW.toISOString()},
			"a-2": {choice: "skip", note: "", answeredAt: NOW.toISOString()},
		});
	});
});

describe("POST /api/v1/decisions/:slug/submit", () => {
	it("stamps submittedAt beside the saved answers", async () => {
		const files: Record<string, string> = {
			...staged(),
			"meetings.answers.json": JSON.stringify({
				"a-1": {choice: "skip", note: "", answeredAt: "2026-10-27T14:00:00.000Z"},
			}),
		};
		const request = setup(files);
		await expect(request("POST", "/meetings/submit")).resolves.toStrictEqual({
			status: 200,
			body: {submittedAt: NOW.toISOString()},
		});
		expect(JSON.parse(files["meetings.answers.json"])).toStrictEqual({
			"a-1": {choice: "skip", note: "", answeredAt: "2026-10-27T14:00:00.000Z"},
			submittedAt: NOW.toISOString(),
		});
	});

	it("answers 404 when nothing is staged under the slug", async () => {
		const request = setup({});
		await expect(request("POST", "/meetings/submit")).resolves.toStrictEqual({
			status: 404,
			body: {error: "No decision page staged as meetings"},
		});
	});
});

describe("createDecisionsApp", () => {
	it("serves the decision pages under /api/v1/decisions with the context set", async () => {
		const ctx = {decisions: memoryStore({})} as unknown as ServerContext;
		const response = await createDecisionsApp(ctx).fetch(new Request("http://x/api/v1/decisions/missing"));
		expect(response.status).toBe(404);
	});
});
