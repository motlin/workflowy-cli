import {z} from "zod";
import {INTERNAL_API_NOT_CONFIGURED} from "../internal-api-error.js";
import {defineOp, fail, ok} from "./define.js";

/** The signed-in Workflowy account. `email` is `WORKFLOWY_USERNAME`, "" when unset. */
export const accountGet = defineOp({
	input: z.object({}),
	async run(ctx) {
		const adapter = ctx.internalAdapter?.();
		if (!adapter) {
			return fail(503, {error: INTERNAL_API_NOT_CONFIGURED});
		}
		const {userId, joinedAt, fullName} = await adapter.getAccount();
		return ok({userId, joinedAt: joinedAt.toISOString(), fullName, email: ctx.config.accountEmail});
	},
});
