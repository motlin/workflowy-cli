/**
 * Tag colors stored in upstream's root (Home) metadata through the internal
 * API, so they match workflowy.com: `color.tags[<lowercased tag incl. #/@>] = <color index>`.
 *
 * `GET /` -> `{colors: {name: color}}`; `PUT /:name` `{color}` sets one;
 * `DELETE /:name` clears one.
 */

import {Hono} from "hono";
import type {AppEnv} from "../context.js";
import {withAdapter} from "../internal-api.js";
import type {TagColorName} from "../../tag-colors.js";

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

export function createTagsRouter(): Hono<AppEnv> {
	const router = new Hono<AppEnv>();

	router.get(
		"/",
		withAdapter(async (c, adapter) => {
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
			return c.json({colors});
		}),
	);

	router.put(
		"/:name",
		withAdapter<"/:name">(async (c, adapter) => {
			const name = c.req.param("name");
			const body: unknown = await c.req.json().catch(() => {});
			const color = typeof body === "object" && body !== null && "color" in body ? body.color : undefined;
			if (!isColorName(color)) {
				return c.json({error: `Invalid color: ${typeof color === "string" ? color : "(missing)"}`}, 400);
			}
			await adapter.setRootMeta(tagPath(name), COLOR_INDEX[color]);
			return c.json({name, color});
		}),
	);

	router.delete(
		"/:name",
		withAdapter<"/:name">(async (c, adapter) => {
			const name = c.req.param("name");
			await adapter.setRootMeta(tagPath(name), undefined);
			return c.json({name});
		}),
	);

	return router;
}
