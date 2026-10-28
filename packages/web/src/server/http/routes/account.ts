import {Hono} from "hono";
import {callOp} from "../response.js";
import type {ResolveStore} from "../response.js";

/** `GET /` -> the signed-in account. */
export function accountRoutes(resolveStore: ResolveStore): Hono {
	const routes = new Hono();
	routes.get("/", async (c) => callOp(resolveStore, c.req.raw, "account.get", {}));
	return routes;
}
