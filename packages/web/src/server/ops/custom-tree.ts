import {z} from "zod";
import {collectCustomSections, findCustomRoot, readCustomTree} from "../custom-tree.js";
import {defineOp, ok, toJson} from "./define.js";

const CustomNodeSchema = z.strictObject({
	name: z.string(),
	completed: z.boolean(),
	get children(): z.ZodArray<typeof CustomNodeSchema> {
		return z.array(CustomNodeSchema);
	},
});

/** The Custom root, its children for the root picker, and its grammar sections. */
export const CustomTreeResponseSchema = z.strictObject({
	rootId: z.string().nullable(),
	rootChildren: z.array(z.strictObject({id: z.string(), name: z.string()})),
	sections: z.record(z.string(), z.array(CustomNodeSchema)),
});

const GRAMMARS: ReadonlySet<string> = new Set(["Hotkeys", "Themes"]);

/** The grammar sections under the Custom root, read from the cache (never written). */
export const customTreeGet = defineOp({
	input: z.object({rootId: z.string().optional()}),
	output: CustomTreeResponseSchema,
	run(ctx, {rootId: requested}) {
		const {cacheService} = ctx;
		const rootId = findCustomRoot(cacheService.getChildren(null), requested);
		const root = rootId === null ? null : readCustomTree(cacheService, rootId);
		const rootChildren =
			rootId === null ? [] : cacheService.getChildren(rootId).map(({id, name}) => ({id, name: name ?? ""}));
		return ok(toJson({rootId, rootChildren, sections: collectCustomSections(root, GRAMMARS)}));
	},
});
