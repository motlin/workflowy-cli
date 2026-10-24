/**
 * The generated `<style id="tags-None">` sheet that colors tags, following upstream's
 * `generateStylesString`: one rule set per color, matching `.contentTag[data-val]`
 * (the lowercased tag) so coloring is case-insensitive and needs no per-span classes.
 */

/** Lowercase every tag key, so lookups by `data-val` (or `tag.toLowerCase()`) hit. */
export function normalizeTagColors(colors: Readonly<Record<string, string>>): Record<string, string> {
	return Object.fromEntries(Object.entries(colors).map(([tag, color]) => [tag.toLowerCase(), color]));
}

function escapeCssString(value: string): string {
	return value.replaceAll("\\", String.raw`\\`).replaceAll('"', String.raw`\"`);
}

function rule(selectors: string, declarations: readonly string[]): string {
	return `${selectors} {\n${declarations.map((declaration) => `    ${declaration};\n`).join("")}}`;
}

function colorGroupCss(color: string, tags: readonly string[]): string {
	const selectors = (suffix: string, prefix = "") =>
		tags.map((tag) => `${prefix}.contentTag[data-val="${escapeCssString(tag)}"]${suffix}`).join(",");
	return [
		rule(selectors(""), [
			`background-color: var(--wf-background-${color})!important`,
			"color: var(--wf-text-primary)!important",
		]),
		rule(selectors(" span"), ["background: none"]),
		rule(selectors(":hover"), ["background-color: inherit", "text-decoration: underline"]),
		rule(selectors(".contentTag .contentTagText"), ["text-decoration: none"]),
		rule(selectors("", ".notes "), []),
		rule(selectors("", ".done "), ["opacity: 0.5"]),
	].join("\n");
}

/** The stylesheet text for a lowercased tag -> color name map; empty without colors. */
export function buildTagColorCss(colors: Readonly<Record<string, string>>): string {
	const groups = new Map<string, string[]>();
	for (const [tag, color] of Object.entries(colors)) {
		const group = groups.get(color);
		if (group) {
			group.push(tag);
		} else {
			groups.set(color, [tag]);
		}
	}
	return [...groups].map(([color, tags]) => `${colorGroupCss(color, tags)}\n`).join("");
}
