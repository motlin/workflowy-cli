/**
 * The signed-file proxy: `GET /:nodeId/preview?w=` and `GET /:nodeId/original` answer a 302 to the short-lived signed S3 URL
 * that workflowy.com's session-cookie `/file-proxy/` endpoints hand out. The public API never returns attachment URLs, and
 * the browser has no session cookie, so the local server asks on its behalf and caches the answer for ten minutes.
 */

import {Hono} from "hono";
import type {NodeAttachment} from "../../node-types.js";
import type {AppEnv} from "../context.js";
import {loadAttachments, resolveNodeId} from "./nodes.js";

const SIGNED_URL_TTL_MS = 10 * 60_000;
/** Upstream rounds every requested preview width up to a multiple of this. */
const WIDTH_STEP = 400;

type PreviewRequest = {kind: "original"} | {kind: "preview"; width: number; height: number};

/**
 * Port of upstream's preview size rule: round the requested width up to a 400px step. When that is at least as wide as the
 * original (and the image is not HEIC, which browsers cannot show), or the image is an animated GIF, ask for the original.
 */
function previewRequest(attachment: NodeAttachment, requestedWidth: number): PreviewRequest {
	const originalWidth = attachment.imageOriginalWidth;
	const originalHeight = attachment.imageOriginalHeight;
	if (attachment.isAnimatedGif || originalWidth === null || originalHeight === null) {
		return {kind: "original"};
	}
	const width = Math.max(1, Math.ceil(requestedWidth / WIDTH_STEP)) * WIDTH_STEP;
	const heic = /^image\/hei[cf]$/u.test(attachment.fileType);
	if (width >= originalWidth && !heic) {
		return {kind: "original"};
	}
	return {kind: "preview", width, height: Math.round((width * originalHeight) / originalWidth)};
}

export interface FilesRouterOptions {
	now?: () => number;
}

export function createFilesRouter(options: FilesRouterOptions = {}): Hono<AppEnv> {
	const now = options.now ?? Date.now;
	const router = new Hono<AppEnv>();
	const signed = new Map<string, {url: string; at: number}>();

	router.get("/:nodeId/:variant{preview|original}", async (c) => {
		const ctx = c.get("ctx");
		const adapter = ctx.internalAdapter?.();
		if (!adapter) {
			return c.json({error: "files-unavailable"}, 503);
		}
		const id = resolveNodeId(ctx, c.req.param("nodeId"));
		const attachment = id === null ? undefined : loadAttachments(ctx, [id]).get(id);
		if (id === null || attachment === undefined || attachment.isDeleted) {
			return c.json({error: "Attachment not found"}, 404);
		}
		const ownerId = await adapter.fileOwnerId();
		const original = `/file-proxy/signed-original/${ownerId}/${id}/?attempt=1`;
		let path = original;
		if (c.req.param("variant") === "preview") {
			const requested = Number(c.req.query("w"));
			const request = previewRequest(attachment, Number.isFinite(requested) && requested > 0 ? requested : 700);
			if (request.kind === "preview") {
				const folder =
					attachment.objectFolder === null ? "" : `&folder=${encodeURIComponent(attachment.objectFolder)}`;
				path = `/file-proxy/signed-preview/${ownerId}/${id}/${request.width}x${request.height}/?attempt=1${folder}`;
			}
		}
		const cached = signed.get(path);
		if (cached !== undefined && now() - cached.at < SIGNED_URL_TTL_MS) {
			return c.redirect(cached.url, 302);
		}
		try {
			const url = await adapter.signedFileUrl(path);
			signed.set(path, {url, at: now()});
			return c.redirect(url, 302);
		} catch {
			return c.json({error: "files-unavailable"}, 503);
		}
	});

	return router;
}
