import {describe, expect, it} from "vite-plus/test";
import {normalizeForSearch, parseQuery} from "../src/search/index.js";
import {SO_PLAIN_NAMES as PLAIN_NAMES, SO_ROWS, searchItem as item} from "./helpers/search-so-fixture.js";

function matchingNames(query: string): string[] {
	const parsed = parseQuery(query);
	return SO_ROWS.flatMap((row, index) => (parsed.matches(row).matches ? [PLAIN_NAMES[index]!] : []));
}

describe("normalizeForSearch", () => {
	it("strips diacritics and lowercases", () => {
		expect(normalizeForSearch("Café Ünïcode")).toBe("cafe unicode");
	});
});

describe("parseQuery text matching (upstream SO-root fixture)", () => {
	it("treats the last token as a word-start prefix", () => {
		expect(matchingNames("app")).toStrictEqual(["Alpha apple pie", "applesauce jar"]);
	});

	it("requires non-last tokens to be whole words", () => {
		expect(matchingNames("app pie")).toStrictEqual([]);
	});

	it("ANDs tokens regardless of order", () => {
		expect(matchingNames("apple pie")).toStrictEqual(["Alpha apple pie"]);
		expect(matchingNames("pie apple")).toStrictEqual(["Alpha apple pie"]);
	});

	it("is case-insensitive", () => {
		expect(matchingNames("Apple")).toStrictEqual(["Alpha apple pie", "applesauce jar"]);
	});

	it("matches quoted phrases as literal substrings", () => {
		expect(matchingNames('"ple pie"')).toStrictEqual(["Alpha apple pie"]);
		expect(matchingNames("“ple pie”")).toStrictEqual(["Alpha apple pie"]);
		expect(matchingNames("«ple pie»")).toStrictEqual(["Alpha apple pie"]);
	});

	it("treats an unterminated quote as a plain term containing the quote", () => {
		expect(matchingNames('"apple')).toStrictEqual([]);
	});

	it("negates with a leading dash", () => {
		expect(matchingNames("-apple")).toStrictEqual(PLAIN_NAMES.slice(2));
		expect(matchingNames('-"apple pie"')).toStrictEqual(PLAIN_NAMES.slice(1));
		expect(matchingNames("apple -sauce")).toStrictEqual(["Alpha apple pie"]);
	});

	it("splits AND groups on OR", () => {
		expect(matchingNames("apple OR zebra")).toStrictEqual(["Alpha apple pie"]);
		expect(matchingNames("apple OR kid -todo")).toStrictEqual(["Alpha apple pie", "kid one"]);
	});

	it("matches tags without a leading word boundary", () => {
		for (const query of ["#so", "sotag", '"#sotag "', "#sotag "]) {
			expect(matchingNames(query)).toStrictEqual(["Tagged #soTag item"]);
		}
	});

	it("reports note-only matches", () => {
		expect(parseQuery("zebra").matches(SO_ROWS[0]!)).toStrictEqual({
			matches: true,
			nameMatches: false,
			noteMatches: true,
			metaMatches: false,
		});
	});

	it("folds diacritics both ways", () => {
		expect(parseQuery("café").matches(item("cafe")).matches).toBe(true);
		expect(parseQuery("cafe").matches(item("Café")).matches).toBe(true);
	});

	it("treats a lone dash and an empty phrase as an empty query", () => {
		expect(parseQuery("-").isEmpty()).toBe(true);
		expect(parseQuery('""').isEmpty()).toBe(true);
		expect(parseQuery("apple").isEmpty()).toBe(false);
	});

	it("matches only at word starts", () => {
		const green = item("Green apple pie");
		expect(parseQuery("pple").matches(green).matches).toBe(false);
		expect(parseQuery("ree").matches(green).matches).toBe(false);
		expect(parseQuery("e p").matches(green).matches).toBe(false);
		expect(parseQuery('"apple pie"').matches(green).matches).toBe(true);
	});

	it("does not search HTML markup", () => {
		expect(parseQuery("span").matches(item('<span class="colored c-red">x</span>')).matches).toBe(false);
	});

	it("does not reveal completed items for plain text", () => {
		expect(parseQuery("apple -pie").revealsCompleted()).toBe(false);
	});
});

describe("QueryNode.ranges", () => {
	it("returns merged, sorted ranges on plain text", () => {
		expect(parseQuery("apple pie ").ranges("Green apple pie")).toStrictEqual([
			[6, 11],
			[12, 15],
		]);
		expect(parseQuery("#fruitTag").ranges("Plain item #fruitTag")).toStrictEqual([[11, 20]]);
	});

	it("excludes negated terms and merges overlaps", () => {
		expect(parseQuery('"apple p" pie -green').ranges("Green apple pie")).toStrictEqual([[6, 15]]);
	});

	it("maps ranges back through diacritic folding", () => {
		expect(parseQuery("cafe").ranges("Le Café noir")).toStrictEqual([[3, 7]]);
		expect(parseQuery("noir").ranges("Le Café noir")).toStrictEqual([[9, 13]]);
	});
});
