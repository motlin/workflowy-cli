/**
 * Tag colors stored in upstream's root (Home) metadata through the internal
 * API, so they match workflowy.com: `color.tags[<lowercased tag incl. #/@>] = <color index>`.
 */

import {z} from "zod";
import {INTERNAL_API_NOT_CONFIGURED} from "../internal-api-error.js";
import type {TagColorName} from "../../tag-colors.js";
import {defineOp, fail, ok} from "./define.js";

/** Upstream's color enum (`red=0 ... pink=9`); `-1` means "no color". */
const COLOR_INDEX: Record<TagColorName, number> = {
	red: 0,
	orange: 1,
	yellow: 2,
	green: 3,
	blue: 4,
	purple: 5,
	gray: 6,
	teal: 7,
	sky: 8,
	pink: 9,
};

const COLOR_BY_INDEX = new Map<unknown, string>(Object.entries(COLOR_INDEX).map(([color, index]) => [index, color]));

function isColorName(color: unknown): color is TagColorName {
	return typeof color === "string" && Object.hasOwn(COLOR_INDEX, color);
}

const TAGS_PATH = ["color", "tags"];

function tagPath(name: string): string[] {
	return [...TAGS_PATH, name.toLowerCase()];
}

const notConfigured = () => fail(503, {error: INTERNAL_API_NOT_CONFIGURED});

/** `{colors: {name: color}}`, skipping indexes outside the palette. */
export const tagsList = defineOp({
	input: z.object({}),
	async run(ctx) {
		const adapter = ctx.internalAdapter?.();
		if (!adapter) {
			return notConfigured();
		}
		const stored = await adapter.getRootMeta(TAGS_PATH);
		const colors: Record<string, string> = {};
		if (typeof stored === "object" && stored !== null) {
			for (const [name, index] of Object.entries(stored)) {
				const color = COLOR_BY_INDEX.get(index);
				if (color) {
					colors[name] = color;
				}
			}
		}
		return ok({colors});
	},
});

/** Sets one tag's color; the color is validated here so the 400 names what was sent. */
export const tagsSet = defineOp({
	input: z.object({name: z.string(), color: z.unknown()}),
	async run(ctx, {name, color}) {
		const adapter = ctx.internalAdapter?.();
		if (!adapter) {
			return notConfigured();
		}
		if (!isColorName(color)) {
			return fail(400, {error: `Invalid color: ${typeof color === "string" ? color : "(missing)"}`});
		}
		await adapter.setRootMeta(tagPath(name), COLOR_INDEX[color]);
		return ok({name, color});
	},
});

/** Clears one tag's color. */
export const tagsClear = defineOp({
	input: z.object({name: z.string()}),
	async run(ctx, {name}) {
		const adapter = ctx.internalAdapter?.();
		if (!adapter) {
			return notConfigured();
		}
		await adapter.setRootMeta(tagPath(name), undefined);
		return ok({name});
	},
});
