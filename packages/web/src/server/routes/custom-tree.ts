/** `GET /api/v1/custom-tree?rootId=<optional>` -> `{rootId, rootChildren, sections}` read from the cache (never written). */

import {Hono} from "hono";
import type {AppEnv} from "../context.js";
import {collectCustomSections, findCustomRoot, readCustomTree} from "../custom-tree.js";

const GRAMMARS: ReadonlySet<string> = new Set(["Hotkeys", "Themes"]);

export function createCustomTreeRouter(): Hono<AppEnv> {
	const router = new Hono<AppEnv>();
	router.get("/", (c) => {
		const {cacheService} = c.get("ctx");
		const rootId = findCustomRoot(cacheService.getChildren(null), c.req.query("rootId"));
		const root = rootId === null ? null : readCustomTree(cacheService, rootId);
		const rootChildren =
			rootId === null ? [] : cacheService.getChildren(rootId).map(({id, name}) => ({id, name: name ?? ""}));
		return c.json({rootId, rootChildren, sections: collectCustomSections(root, GRAMMARS)});
	});
	return router;
}
