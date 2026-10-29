import {eq} from "drizzle-orm";
import {z} from "zod";
import {localSettings} from "@workflowy/shared/db";
import {INTERNAL_API_NOT_CONFIGURED} from "../internal-api-error.js";
import {defineOp, fail, ok, toJson} from "./define.js";

const CODENAME = /^[a-z0-9_-]+$/u;
const EnabledSchema = z.record(z.string(), z.literal(true));
const VisibleFeatureSchema = z.strictObject({
	codename: z.string(),
	name: z.string(),
	label: z.string().nullable(),
	description: z.string().nullable(),
});
/** The visible feature list and enabled dict; `available` is false without the internal API. */
export const FeaturesResponseSchema = z.strictObject({
	visible: z.array(VisibleFeatureSchema),
	enabled: EnabledSchema,
	available: z.boolean(),
});
/** The enabled dict after a toggle. */
export const FeatureSetResponseSchema = z.strictObject({enabled: EnabledSchema});

/** The server's visible feature list and enabled dict; without the internal API, the durable `setting:features` copy with `available: false`. */
export const featuresGet = defineOp({
	input: z.object({}),
	output: FeaturesResponseSchema,
	async run(ctx) {
		const adapter = ctx.internalAdapter?.();
		if (adapter) {
			return ok(
				toJson({
					visible: await adapter.visibleFeatures(),
					enabled: await adapter.enabledFeatures(),
					available: true,
				}),
			);
		}
		const row = ctx.db.select().from(localSettings).where(eq(localSettings.key, "setting:features")).get();
		const stored = row ? EnabledSchema.safeParse(JSON.parse(row.json)) : undefined;
		return ok({visible: [], enabled: stored?.success ? stored.data : {}, available: false});
	},
});

/** Turns a feature on or off; a write needs the account, so no adapter means 503. */
export const featuresSet = defineOp({
	input: z.object({codename: z.string().regex(CODENAME), on: z.boolean()}).strict(),
	output: FeatureSetResponseSchema,
	async run(ctx, {codename, on}) {
		const adapter = ctx.internalAdapter?.();
		if (!adapter) {
			return fail(503, {error: INTERNAL_API_NOT_CONFIGURED});
		}
		return ok({enabled: await adapter.setFeature(codename, on)});
	},
});
