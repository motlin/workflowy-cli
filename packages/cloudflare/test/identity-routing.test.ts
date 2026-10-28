import {afterAll, beforeAll, describe, expect, it} from "vite-plus/test";
import {SignJWT, exportJWK, generateKeyPair} from "jose";
import {startHarness} from "./harness";
import type {Harness} from "./harness";
import {storeClient} from "../src/store-client";
import type {UserStore} from "../src/user-store";

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

	it("reaches a migrated op over RPC under the Access identity, and the DO answers the op itself", async () => {
		const jwt = await new SignJWT({email: "alice@example.com"})
			.setProtectedHeader({alg: "RS256"})
			.setAudience(audience)
			.setIssuer(`https://${teamDomain}`)
			.setIssuedAt()
			.setExpirationTime("1h")
			.sign(privateKey);
		const viaWorker = await h.mf.dispatchFetch("http://localhost/api/v1/account", {
			headers: {"Cf-Access-Jwt-Assertion": jwt},
		});
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Miniflare types its namespace with undici classes
		const ns = (await h.mf.getDurableObjectNamespace("USER_STORE")) as unknown as DurableObjectNamespace<UserStore>;
		const viaRpc = await storeClient(ns.get(ns.idFromName("alice@example.com"))).call("account.get", {});

		const body: unknown = await viaWorker.json();
		expect(viaWorker.status).toBe(503);
		// The RPC result is built in another realm, so compare it as JSON.
		expect(JSON.stringify(viaRpc)).toBe(JSON.stringify({ok: false, status: 503, body}));
		expect(JSON.stringify(body)).toContain("internal API is not configured");
	});

	it("serves the migrated routers from the Worker only: the Durable Object's own app answers 404", async () => {
		const jwt = await new SignJWT({email: "alice@example.com"})
			.setProtectedHeader({alg: "RS256"})
			.setAudience(audience)
			.setIssuer(`https://${teamDomain}`)
			.setIssuedAt()
			.setExpirationTime("1h")
			.sign(privateKey);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Miniflare types its namespace with undici classes
		const ns = (await h.mf.getDurableObjectNamespace("USER_STORE")) as unknown as DurableObjectNamespace;
		const stub = ns.get(ns.idFromName("alice@example.com"));
		const paths = [
			"/api/v1/account",
			"/api/v1/features",
			"/api/v1/custom-tree",
			"/api/changes?since=1d",
			"/api/v1/tags/autocomplete",
			"/api/v1/tags",
			"/api/v1/stars",
			"/api/v1/preferences",
			"/api/v1/expansion",
			"/api/v1/files/11111111-2222-3333-4444-555555555555/original",
		];

		const viaDo = await Promise.all(
			paths.map(async (path) => (await stub.fetch(`http://localhost${path}`)).status),
		);
		const viaWorker = await Promise.all(
			paths.slice(1).map(async (path) => {
				const response = await h.mf.dispatchFetch(`http://localhost${path}`, {
					headers: {"Cf-Access-Jwt-Assertion": jwt},
				});
				return {status: response.status, body: await response.json()};
			}),
		);

		expect(viaDo).toStrictEqual([404, 404, 404, 404, 404, 404, 404, 404, 404, 404]);
		expect(viaWorker.map(({status}) => status)).toStrictEqual([200, 200, 200, 200, 503, 503, 503, 503, 503]);
		expect(viaWorker[0]?.body).toStrictEqual({visible: [], enabled: {}, available: false});
		expect(viaWorker[1]?.body).toMatchObject({rootId: null, rootChildren: []});
		expect(viaWorker[3]?.body).toStrictEqual({tags: []});

		const ladderViaDo = await stub.fetch("http://localhost/api/v1/ladder/move", {method: "POST", body: "{}"});
		const ladderViaWorker = await h.mf.dispatchFetch("http://localhost/api/v1/ladder/move", {
			method: "POST",
			headers: {"Cf-Access-Jwt-Assertion": jwt, "content-type": "application/json"},
			body: "{}",
		});
		expect(ladderViaDo.status).toBe(404);
		expect(ladderViaWorker.status).toBe(400);
		await expect(ladderViaWorker.json()).resolves.toStrictEqual({
			error: "root, node_id and to_tier are required",
		});
	});
});
