import type {z} from "zod";
import {accountGet} from "./account.js";
import type {Json, OpDefinition, OpResult} from "./define.js";

/** The operation registry; routers move into it one at a time. */
export const Ops = {
	"account.get": accountGet,
} satisfies Record<string, OpDefinition<z.ZodType, Json>>;

export type OpRegistry = typeof Ops;
export type OpName = keyof OpRegistry;
export type OpInput<K extends OpName> = z.input<OpRegistry[K]["input"]>;
export type OpOutput<K extends OpName> =
	OpRegistry[K] extends OpDefinition<z.ZodType, infer T>
		? OpResult<T> extends OpResult<infer V>
			? V
			: never
		: never;
