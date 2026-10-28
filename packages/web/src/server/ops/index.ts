import type {z} from "zod";
import {accountGet} from "./account.js";
import {changesList} from "./changes.js";
import {customTreeGet} from "./custom-tree.js";
import {expansionGet, expansionLeftBarGet, expansionLeftBarPatch, expansionPatch} from "./expansion.js";
import {featuresGet, featuresSet} from "./features.js";
import {preferencesGet, preferencesPatch} from "./preferences.js";
import {starsList, starsOrder, starsRemove, starsRename, starsSet} from "./stars.js";
import {tagIndexAutocomplete} from "./tag-index.js";
import {tagsClear, tagsList, tagsSet} from "./tags.js";
import type {Json, OpDefinition, OpResult} from "./define.js";

/** The operation registry; routers move into it one at a time. */
export const Ops = {
	"account.get": accountGet,
	"changes.list": changesList,
	"customTree.get": customTreeGet,
	"expansion.get": expansionGet,
	"expansion.leftBarGet": expansionLeftBarGet,
	"expansion.leftBarPatch": expansionLeftBarPatch,
	"expansion.patch": expansionPatch,
	"features.get": featuresGet,
	"features.set": featuresSet,
	"preferences.get": preferencesGet,
	"preferences.patch": preferencesPatch,
	"stars.list": starsList,
	"stars.order": starsOrder,
	"stars.remove": starsRemove,
	"stars.rename": starsRename,
	"stars.set": starsSet,
	"tagIndex.autocomplete": tagIndexAutocomplete,
	"tags.clear": tagsClear,
	"tags.list": tagsList,
	"tags.set": tagsSet,
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
