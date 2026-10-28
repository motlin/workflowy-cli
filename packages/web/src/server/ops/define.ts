import type {z} from "zod";
import type {ServerContext} from "../context.js";

export type Json = null | boolean | number | string | Json[] | {[key: string]: Json};

export type OpFailureStatus = 400 | 403 | 404 | 409 | 422 | 500 | 503;

/** Response details an op can ask the HTTP layer for; the op itself never builds a Response. */
export interface OpMeta {
	etag?: string;
	notModified?: true;
	redirect?: string;
	timing?: string[];
}

/** Errors are values, not exceptions: Workers RPC keeps only the message of a thrown error. */
export type OpResult<T> = {ok: true; value: T; meta?: OpMeta} | {ok: false; status: OpFailureStatus; body: Json};

export function ok<T extends Json>(value: T, meta?: OpMeta): OpResult<T> {
	return meta === undefined ? {ok: true, value} : {ok: true, value, meta};
}

export function fail(status: OpFailureStatus, body: Json): OpResult<never> {
	return {ok: false, status, body};
}

export interface OpDefinition<S extends z.ZodType, T extends Json> {
	input: S;
	run(ctx: ServerContext, input: z.output<S>): OpResult<T> | Promise<OpResult<T>>;
}

export function defineOp<S extends z.ZodType, T extends Json>(definition: OpDefinition<S, T>): OpDefinition<S, T> {
	return definition;
}
