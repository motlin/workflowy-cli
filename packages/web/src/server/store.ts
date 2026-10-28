import type {ServerContext} from "./context.js";
import {fail} from "./ops/define.js";
import type {Json, OpDefinition, OpResult} from "./ops/define.js";
import {Ops} from "./ops/index.js";
import type {OpInput, OpName, OpOutput} from "./ops/index.js";
import {withTreeSnapshotRebuild} from "./tree-snapshot.js";
import type {z} from "zod";

/** What the HTTP layer talks to: one `call` per request. A Durable Object stub and the Node host both implement it. */
export interface StoreClient {
	call<K extends OpName>(op: K, input: OpInput<K>): Promise<OpResult<OpOutput<K>>>;
}

type AnyOps = Record<string, OpDefinition<z.ZodType, Json>>;

/** The one cast: the registry maps each op name to its own result type, which an indexed lookup cannot express. */
function typed<K extends OpName>(result: OpResult<Json>): OpResult<OpOutput<K>> {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
	return result as OpResult<OpOutput<K>>;
}

/**
 * Runs ops in this process (the Node host and the Durable Object). A thrown error becomes a 500, as Hono does.
 * With `keepSnapshotWarm` (the host bound a tree snapshot), an op that wrote schedules a background rebuild, so searches rarely wait on the ~800ms reload.
 */
export function inProcessStore(
	ctx: ServerContext,
	ops: AnyOps = Ops,
	options: {keepSnapshotWarm?: boolean} = {},
): StoreClient {
	return {
		async call<K extends OpName>(op: K, input: OpInput<K>): Promise<OpResult<OpOutput<K>>> {
			try {
				const definition = ops[op];
				if (definition === undefined) {
					return typed<K>(fail(404, {error: `Unknown op ${op}`}));
				}
				const run = async () => definition.run(ctx, input);
				return typed<K>(
					options.keepSnapshotWarm === true ? await withTreeSnapshotRebuild(ctx.db, run) : await run(),
				);
			} catch {
				return typed<K>(fail(500, "Internal Server Error"));
			}
		},
	};
}
