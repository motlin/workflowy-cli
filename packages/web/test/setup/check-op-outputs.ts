/**
 * Every web test parses each op's successful value against the op's output schema. The registry loads in
 * `beforeAll`, after the test file's own imports, so a file's `vi.mock` still reaches the modules the ops import.
 */
import {beforeAll} from "vite-plus/test";
import {checkOpOutputs} from "../helpers/check-op-outputs.js";

beforeAll(async () => {
	const {Ops} = await import("../../src/server/ops/index.js");
	checkOpOutputs(Ops);
});
