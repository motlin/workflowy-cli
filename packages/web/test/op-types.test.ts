import {describe, expectTypeOf, it} from "vite-plus/test";
import type {OpInput, OpOutput} from "../src/server/ops/index.js";

describe("OpInput and OpOutput pin the client-facing op types", () => {
	it("account.get takes no fields and returns the account", () => {
		expectTypeOf<OpInput<"account.get">>().toEqualTypeOf<Record<string, never>>();
		expectTypeOf<OpOutput<"account.get">>().toEqualTypeOf<{
			userId: number;
			joinedAt: string;
			fullName: string | null;
			email: string;
		}>();
	});

	it("nodes.create takes unvalidated optional fields", () => {
		expectTypeOf<OpInput<"nodes.create">>().toEqualTypeOf<{
			parent_id?: unknown;
			name?: unknown;
			note?: string | undefined;
			layoutMode?: string | undefined;
			index?: unknown;
			position?: unknown;
			after_id?: unknown;
			id?: unknown;
		}>();
	});

	it("expansion.get takes optional flags", () => {
		expectTypeOf<OpInput<"expansion.get">>().toEqualTypeOf<{
			fresh?: boolean | undefined;
			wait?: boolean | undefined;
			ifNoneMatch?: string | undefined;
		}>();
	});
});
