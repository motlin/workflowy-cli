import {resolveIdentity} from "./access";
import type {AccessEnv} from "./access";

export {UserStore} from "./user-store";

const dynamicRoutes = [new URLPattern({pathname: "/health"}), new URLPattern({pathname: "/api/*"})];

export default {
	async fetch(request, env): Promise<Response> {
		if (dynamicRoutes.some((pattern) => pattern.test(request.url))) {
			const identity = await resolveIdentity(request, env);
			if ("status" in identity) {
				return new Response(identity.status === 401 ? "Unauthorized" : "Forbidden", {status: identity.status});
			}
			const stub = env.USER_STORE.get(env.USER_STORE.idFromName(identity.email));
			return stub.fetch(request);
		}
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env & AccessEnv>;
