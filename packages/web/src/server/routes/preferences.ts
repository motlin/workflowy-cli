/**
 * Account-global preferences stored in upstream's root (Home) metadata through
 * the internal API, so they match workflowy.com.
 *
 * `GET /` -> preferences; `PATCH /` with any subset -> the full preferences.
 * A `null` removes the stored value.
 */

import {Hono} from "hono";
import {z} from "zod";
import type {WorkflowyInternalAdapter} from "@workflowy/shared/internal";
import type {AppEnv} from "../context.js";
import {withAdapter} from "../internal-api.js";

const PreferencesPatchSchema = z
	.object({
		dateFormat: z.string().nullable(),
		timeFormat: z.string().nullable(),
		weekStartDay: z.number().int().min(0).max(6).nullable(),
		slashDiscovered: z.boolean(),
		notesRootId: z.string().nullable(),
	})
	.partial()
	.strict();

type PreferencesPatch = z.infer<typeof PreferencesPatchSchema>;
type Preferences = Required<PreferencesPatch>;

const KEYS = ["dateFormat", "timeFormat", "weekStartDay", "slashDiscovered", "notesRootId"] as const;

/** Each preference's root metadata path. */
const PATHS: Record<keyof Preferences, string[]> = {
	dateFormat: ["dateFormat"],
	timeFormat: ["timeFormat"],
	weekStartDay: ["weekStartDay"],
	slashDiscovered: ["slash", "discovered"],
	notesRootId: ["notesRootId"],
};

function asString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

/** Read the preferences, treating missing or mistyped values as null (false for the flag). */
async function readPreferences(adapter: WorkflowyInternalAdapter): Promise<Preferences> {
	const [dateFormat, timeFormat, weekStartDay, slashDiscovered, notesRootId] = await Promise.all(
		KEYS.map(async (key) => adapter.getRootMeta(PATHS[key])),
	);
	return {
		dateFormat: asString(dateFormat),
		timeFormat: asString(timeFormat),
		weekStartDay: typeof weekStartDay === "number" ? weekStartDay : null,
		slashDiscovered: slashDiscovered === true,
		notesRootId: asString(notesRootId),
	};
}

export function createPreferencesRouter(): Hono<AppEnv> {
	const router = new Hono<AppEnv>();

	router.get(
		"/",
		withAdapter(async (c, adapter) => c.json(await readPreferences(adapter))),
	);

	router.patch(
		"/",
		withAdapter(async (c, adapter) => {
			const body = PreferencesPatchSchema.safeParse(await c.req.json().catch(() => {}));
			if (!body.success) {
				return c.json({error: body.error.message}, 400);
			}
			const patch = body.data;
			const changes = KEYS.filter((key) => key in patch).map((key) => ({
				path: PATHS[key],
				value: patch[key] ?? undefined,
			}));
			if (changes.length > 0) {
				await adapter.setRootMetaValues(changes);
			}
			return c.json(await readPreferences(adapter));
		}),
	);

	return router;
}
