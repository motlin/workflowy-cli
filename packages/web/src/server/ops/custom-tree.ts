import {z} from "zod";
import {collectCustomSections, findCustomRoot, readCustomTree} from "../custom-tree.js";
import {defineOp, jsonOf, ok} from "./define.js";

const GRAMMARS: ReadonlySet<string> = new Set(["Hotkeys", "Themes"]);

/** The grammar sections under the Custom root, read from the cache (never written). */
export const customTreeGet = defineOp({
	input: z.object({rootId: z.string().optional()}),
	run(ctx, {rootId: requested}) {
		const {cacheService} = ctx;
		const rootId = findCustomRoot(cacheService.getChildren(null), requested);
		const root = rootId === null ? null : readCustomTree(cacheService, rootId);
		const rootChildren =
			rootId === null ? [] : cacheService.getChildren(rootId).map(({id, name}) => ({id, name: name ?? ""}));
		return ok(jsonOf({rootId, rootChildren, sections: collectCustomSections(root, GRAMMARS)}));
	},
});
