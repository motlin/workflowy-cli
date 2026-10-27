import {afterAll, beforeAll, describe, expect, it} from "vite-plus/test";
import {SignJWT, exportJWK, generateKeyPair} from "jose";
import {startHarness} from "./harness";
import type {Harness} from "./harness";

const teamDomain = "team.example.com";
const audience = "aud-routing";
const url = "http://localhost/api/admin/local-settings";

describe("worker routes each Access email to its own Durable Object", () => {
	let h: Harness;
	let privateKey: CryptoKey;

	beforeAll(async () => {
		const pair = await generateKeyPair("RS256");
		privateKey = pair.privateKey;
		const jwks = JSON.stringify({keys: [{...(await exportJWK(pair.publicKey)), alg: "RS256", use: "sig"}]});
		h = await startHarness(
			"../src/worker.ts",
			"UserStore",
			undefined,
			{
				ACCESS_TEAM_DOMAIN: teamDomain,
				ACCESS_AUD: audience,
				ALLOWED_EMAILS: "Alice@example.com, bob@example.com",
			},
			{
				outboundService: (request: Request): Response =>
					new URL(request.url).pathname === "/cdn-cgi/access/certs"
						? new Response(jwks, {headers: {"content-type": "application/json"}})
						: new Response("unexpected", {status: 500}),
			},
		);
	}, 120_000);

	afterAll(async () => {
		await h.dispose();
	});

	async function as(email: string, init: {method?: string; body?: string} = {}): Promise<unknown> {
		const jwt = await new SignJWT({email})
			.setProtectedHeader({alg: "RS256"})
			.setAudience(audience)
			.setIssuer(`https://${teamDomain}`)
			.setIssuedAt()
			.setExpirationTime("1h")
			.sign(privateKey);
		const response = await h.mf.dispatchFetch(url, {
			...init,
			headers: {"Cf-Access-Jwt-Assertion": jwt, "content-type": "application/json"},
		});
		return response.json();
	}

	async function named(name: string): Promise<unknown> {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Miniflare types its namespace with undici classes
		const ns = (await h.mf.getDurableObjectNamespace("USER_STORE")) as unknown as DurableObjectNamespace;
		return (await ns.get(ns.idFromName(name)).fetch(url)).json();
	}

	it("stores a valid token's writes in the DO named by the lowercased email, not dev, and keeps emails separate", async () => {
		await as("ALICE@example.com", {
			method: "PUT",
			body: JSON.stringify([{key: "setting:theme", json: '"dark"', updatedAt: 1}]),
		});

		const row = {key: "setting:theme", json: '"dark"', updatedAt: 1};
		await expect(named("alice@example.com")).resolves.toStrictEqual([row]);
		await expect(named("dev")).resolves.toStrictEqual([]);
		await expect(as("bob@example.com")).resolves.toStrictEqual([]);
		await expect(as("alice@example.com")).resolves.toStrictEqual([row]);
	});
});
