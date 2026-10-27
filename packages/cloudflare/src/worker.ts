import {resolveIdentity} from "./access";
import type {AccessEnv} from "./access";

export {UserStore} from "./user-store";

const dynamicRoutes = [new URLPattern({pathname: "/health"}), new URLPattern({pathname: "/api/*"})];

/**
 * The app already compresses API responses. Without `encodeBody: "manual"` the runtime assumes a response's body is plain and
 * encodes it again to match `Content-Encoding`, so browsers decode one layer and read gzip bytes as JSON.
 */
function passEncodedBody(response: Response): Response {
	if (!response.headers.has("content-encoding") || response.webSocket) {
		return response;
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
		encodeBody: "manual",
	});
}

export default {
	async fetch(request, env): Promise<Response> {
		if (dynamicRoutes.some((pattern) => pattern.test(request.url))) {
			const identity = await resolveIdentity(request, env);
			if ("status" in identity) {
				return new Response(identity.status === 401 ? "Unauthorized" : "Forbidden", {status: identity.status});
			}
			const stub = env.USER_STORE.get(env.USER_STORE.idFromName(identity.email));
			return passEncodedBody(await stub.fetch(request));
		}
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env & AccessEnv>;
