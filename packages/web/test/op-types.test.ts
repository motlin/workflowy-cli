import {describe, expectTypeOf, it} from "vite-plus/test";
import type {OpInput, OpOutput} from "../src/server/ops/index.js";
import type {TagColorName} from "../src/tag-colors.js";
import type {
	BacklinksResponse,
	ExportTreeItem,
	FoundDatesResponse,
	HomeResponse,
	MirrorsResponse,
	NodeChangesResponse,
	NodeResponse,
	OutlineViewResponse,
	SubtreeItem,
	UpdateNodeResponse,
} from "../src/node-types.js";

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

	it("nodes.create takes a parent, a name and optional slot fields", () => {
		expectTypeOf<OpInput<"nodes.create">>().toEqualTypeOf<{
			parent_id: string | null;
			name: string;
			note?: string | undefined;
			layoutMode?: string | undefined;
			index?: number | undefined;
			position?: number | undefined;
			after_id?: string | null | undefined;
			id?: string | undefined;
		}>();
	});

	it("expansion.get takes optional flags", () => {
		expectTypeOf<OpInput<"expansion.get">>().toEqualTypeOf<{
			fresh?: boolean | undefined;
			wait?: boolean | undefined;
			ifNoneMatch?: string | undefined;
		}>();
	});

	it("output schemas type the small ops' values", () => {
		expectTypeOf<OpOutput<"tags.set">>().toEqualTypeOf<{name: string; color: TagColorName}>();
		expectTypeOf<OpOutput<"tags.list">>().toEqualTypeOf<{colors: Record<string, string>}>();
		expectTypeOf<OpOutput<"stars.remove">>().toEqualTypeOf<null>();
		expectTypeOf<OpOutput<"expansion.leftBarGet">>().toEqualTypeOf<{keys: string[]}>();
		expectTypeOf<OpOutput<"tagIndex.autocomplete">>().toEqualTypeOf<{tags: {tag: string; count: number}[]}>();
		expectTypeOf<OpOutput<"changes.list">["cutoffDate"]>().toEqualTypeOf<string>();
	});

	it("output schemas type the node ops' values", () => {
		expectTypeOf<OpOutput<"nodes.get">>().toEqualTypeOf<{node: NodeResponse}>();
		expectTypeOf<OpOutput<"nodes.list">>().toEqualTypeOf<{nodes: NodeResponse[]}>();
		expectTypeOf<OpOutput<"nodes.children">>().toEqualTypeOf<{children: Record<string, NodeResponse[]>}>();
		expectTypeOf<OpOutput<"nodes.changes">>().toEqualTypeOf<NodeChangesResponse>();
		expectTypeOf<OpOutput<"nodes.view">>().toEqualTypeOf<OutlineViewResponse>();
		expectTypeOf<OpOutput<"nodes.backlinks">>().toEqualTypeOf<BacklinksResponse>();
		expectTypeOf<OpOutput<"nodes.foundDates">>().toEqualTypeOf<FoundDatesResponse>();
		expectTypeOf<OpOutput<"nodes.mirrors">>().toEqualTypeOf<MirrorsResponse>();
		expectTypeOf<OpOutput<"nodes.update">>().toEqualTypeOf<UpdateNodeResponse>();
		expectTypeOf<OpOutput<"nodes.delete">>().toEqualTypeOf<null>();
		expectTypeOf<OpOutput<"nodes.trees">>().toEqualTypeOf<{ids: string[]}>();
		expectTypeOf<OpOutput<"nodes.move">>().toEqualTypeOf<{nodes: NodeResponse[]}>();
		expectTypeOf<OpOutput<"nodes.detachMirror">>().toEqualTypeOf<{node: NodeResponse | null}>();
		expectTypeOf<OpOutput<"nodes.swapMirrorOrigin">>().toEqualTypeOf<
			{swapped: {mirrorId: string; originalId: string}} | {warning: string}
		>();
		expectTypeOf<OpOutput<"home.get">>().toEqualTypeOf<{layoutMode: string}>();
		for (const name of ["nodes.create", "nodes.complete", "nodes.uncomplete", "nodes.restore"] as const) {
			expectTypeOf<OpOutput<typeof name>>().toEqualTypeOf<{node: NodeResponse}>();
		}
		expectTypeOf<OpOutput<"nodes.moveOne">>().toEqualTypeOf<{nodes: NodeResponse[]}>();
		expectTypeOf<OpOutput<"nodes.mirror">>().toEqualTypeOf<{nodes: NodeResponse[]}>();
		expectTypeOf<OpOutput<"nodes.ancestors">>().toEqualTypeOf<{ancestors: NodeResponse[]}>();
		expectTypeOf<OpOutput<"nodes.duplicate">>().toEqualTypeOf<{ids: string[]}>();
		expectTypeOf<OpOutput<"nodes.subtreeIds">>().toEqualTypeOf<{items: SubtreeItem[]}>();
		expectTypeOf<OpOutput<"nodes.exportTree">>().toEqualTypeOf<{items: ExportTreeItem[]}>();
		expectTypeOf<OpOutput<"nodes.setHome">>().toEqualTypeOf<HomeResponse>();
	});
});
