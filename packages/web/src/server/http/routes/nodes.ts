import {Hono} from "hono";
import {callOp} from "../response.js";
import type {ResolveStore} from "../response.js";

/** A request body that is not valid JSON reads as undefined, so the op answers its own 400. */
async function body(request: Request): Promise<unknown> {
	return request.json().catch(() => {});
}

/**
 * The node read routes (see `ops/nodes.ts` for what each answers). Registration order matters: the fixed paths
 * (`/changes`, `/children`, `/view`, `/export-tree`) come before `/:id`.
 */
export function nodesRoutes(resolveStore: ResolveStore): Hono {
	const routes = new Hono();
	routes.get("/", async (c) => callOp(resolveStore, c.req.raw, "nodes.list", {parentId: c.req.query("parent_id")}));
	routes.post("/children", async (c) =>
		callOp(resolveStore, c.req.raw, "nodes.children", await body(c.req.raw), {
			error: "parentIds must be an array of strings",
		}),
	);
	routes.get("/changes", async (c) =>
		callOp(resolveStore, c.req.raw, "nodes.changes", {since: c.req.query("since")}),
	);
	routes.post("/view", async (c) =>
		callOp(resolveStore, c.req.raw, "nodes.view", await body(c.req.raw), {
			error: "body must be {rootId, expandedIds, limit, showCompleted}",
		}),
	);
	routes.post("/export-tree", async (c) =>
		callOp(resolveStore, c.req.raw, "nodes.exportTree", await body(c.req.raw), {
			error: "ids must be an array of strings",
		}),
	);
	routes.get("/:id", async (c) => callOp(resolveStore, c.req.raw, "nodes.get", {id: c.req.param("id")}));
	routes.get("/:id/subtree-ids", async (c) =>
		callOp(resolveStore, c.req.raw, "nodes.subtreeIds", {id: c.req.param("id")}),
	);
	routes.get("/:id/ancestors", async (c) =>
		callOp(resolveStore, c.req.raw, "nodes.ancestors", {id: c.req.param("id")}),
	);
	routes.get("/:id/backlinks", async (c) =>
		callOp(resolveStore, c.req.raw, "nodes.backlinks", {id: c.req.param("id")}),
	);
	routes.get("/:id/found-dates", async (c) =>
		callOp(resolveStore, c.req.raw, "nodes.foundDates", {id: c.req.param("id")}),
	);
	routes.get("/:id/mirrors", async (c) => callOp(resolveStore, c.req.raw, "nodes.mirrors", {id: c.req.param("id")}));
	return routes;
}

/** `GET /` answers Home's layout mode. */
export function homeRoutes(resolveStore: ResolveStore): Hono {
	const routes = new Hono();
	routes.get("/", async (c) => callOp(resolveStore, c.req.raw, "home.get", {}));
	return routes;
}
