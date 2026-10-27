import {createRemoteJWKSet, jwtVerify} from "jose";
import type {JWTVerifyGetKey} from "jose";

/** Optional Worker bindings for Cloudflare Access; `ACCESS_DEV_IDENTITY` is a local-only bypass. */
export interface AccessEnv {
	ACCESS_TEAM_DOMAIN?: string;
	ACCESS_AUD?: string;
	ALLOWED_EMAILS?: string;
	ACCESS_DEV_IDENTITY?: string;
}

export type IdentityResult = {email: string} | {status: 401 | 403};

const remoteKeys = new Map<string, JWTVerifyGetKey>();

function remoteKeysFor(teamDomain: string): JWTVerifyGetKey {
	let keys = remoteKeys.get(teamDomain);
	if (!keys) {
		keys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
		remoteKeys.set(teamDomain, keys);
	}
	return keys;
}

/** Verify the Cloudflare Access JWT and the email allowlist; the identity is the lowercased email. */
export async function resolveIdentity(
	request: Request,
	env: AccessEnv,
	keys?: JWTVerifyGetKey,
): Promise<IdentityResult> {
	if (env.ACCESS_DEV_IDENTITY) {
		return {email: env.ACCESS_DEV_IDENTITY};
	}
	const token = request.headers.get("Cf-Access-Jwt-Assertion");
	if (!token) {
		return {status: 401};
	}
	const {ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: audience} = env;
	if (!teamDomain || !audience) {
		return {status: 403};
	}
	try {
		const {payload} = await jwtVerify(token, keys ?? remoteKeysFor(teamDomain), {
			audience,
			issuer: `https://${teamDomain}`,
		});
		const email = typeof payload.email === "string" ? payload.email.toLowerCase() : undefined;
		const allowed = (env.ALLOWED_EMAILS ?? "")
			.split(",")
			.map((entry) => entry.trim().toLowerCase())
			.filter((entry) => entry !== "");
		return email !== undefined && allowed.includes(email) ? {email} : {status: 403};
	} catch {
		return {status: 403};
	}
}
