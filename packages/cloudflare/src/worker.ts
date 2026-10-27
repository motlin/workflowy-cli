export {UserStore} from "./user-store";

/** Until Cloudflare Access lands (step 10), every request belongs to one fixed identity. */
const DEV_IDENTITY = "dev";

const dynamicRoutes = [new URLPattern({pathname: "/health"}), new URLPattern({pathname: "/api/*"})];

export default {
	async fetch(request, env): Promise<Response> {
		if (dynamicRoutes.some((pattern) => pattern.test(request.url))) {
			const stub = env.USER_STORE.get(env.USER_STORE.idFromName(DEV_IDENTITY));
			return stub.fetch(request);
		}
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
