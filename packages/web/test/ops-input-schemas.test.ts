import {z} from "zod";
import {describe, expect, it} from "vite-plus/test";
import {Ops} from "../src/server/ops/index.js";

/** Op input fields that are still z.unknown()/z.any() and re-validated by hand in run(); shrink to empty. */
const ALLOWED_LOOSE_FIELDS: readonly string[] = [
	"calendar.layoutPreview.body",
	"calendar.layoutPut.body",
	"calendar.layoutUndo.body",
	"calendar.settingsPut.body",
	"ladder.move.root",
	"ladder.move.node_id",
	"ladder.move.to_tier",
	"ladder.move.before_id",
	"ladder.complete.root",
	"ladder.complete.node_id",
	"preferences.patch.patch",
	"tags.set.color",
];

/** Walk a zod schema and return the paths of every field typed z.unknown() or z.any(). */
function looseFields(schema: z.core.$ZodType, path: string): string[] {
	if (schema instanceof z.ZodUnknown || schema instanceof z.ZodAny) {
		return [path];
	}
	if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault) {
		return looseFields(schema.unwrap(), path);
	}
	if (schema instanceof z.ZodObject) {
		return Object.entries(schema.shape).flatMap(([key, field]) => looseFields(field, `${path}.${key}`));
	}
	if (schema instanceof z.ZodRecord) {
		return looseFields(schema.valueType, `${path}.*`);
	}
	if (schema instanceof z.ZodArray) {
		return looseFields(schema.element, `${path}[]`);
	}
	if (schema instanceof z.ZodUnion) {
		return schema.options.flatMap((option) => looseFields(option, path));
	}
	return [];
}

describe("op input schemas", () => {
	it("declare no z.unknown() or z.any() fields beyond the allowlist", () => {
		const loose = Object.entries(Ops).flatMap(([name, op]) => looseFields(op.input, name));
		expect(loose.filter((field) => !ALLOWED_LOOSE_FIELDS.includes(field))).toStrictEqual([]);
	});

	it("keeps the allowlist free of fields that are no longer loose", () => {
		const loose = new Set(Object.entries(Ops).flatMap(([name, op]) => looseFields(op.input, name)));
		expect(ALLOWED_LOOSE_FIELDS.filter((field) => !loose.has(field))).toStrictEqual([]);
	});
});
