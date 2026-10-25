/**
 * Account-global preferences stored in upstream's root (Home) metadata and
 * server-saved account settings through the internal API, so they match
 * workflowy.com.
 *
 * `GET /` -> preferences; `PATCH /` with any subset -> the full preferences.
 * A `null` removes the stored value.
 */

import {Hono} from "hono";
import {z} from "zod";
import type {ServerSetting, WorkflowyInternalAdapter} from "@workflowy/shared/internal";
import type {AppEnv} from "../context.js";
import {withAdapter} from "../internal-api.js";

const PreferencesPatchSchema = z
	.object({
		dateFormat: z.string().nullable(),
		timeFormat: z.string().nullable(),
		weekStartDay: z.number().int().min(0).max(6).nullable(),
		slashDiscovered: z.boolean(),
		notesRootId: z.string().nullable(),
		showCompleted: z.boolean(),
		showKeyboardShortcuts: z.boolean(),
		sameColorForLinks: z.boolean(),
	})
	.partial()
	.strict();

type PreferencesPatch = z.infer<typeof PreferencesPatchSchema>;
type Preferences = Required<PreferencesPatch>;

const KEYS = ["dateFormat", "timeFormat", "weekStartDay", "slashDiscovered", "notesRootId"] as const;

/** Each root-metadata preference's path. */
const PATHS: Record<(typeof KEYS)[number], string[]> = {
	dateFormat: ["dateFormat"],
	timeFormat: ["timeFormat"],
	weekStartDay: ["weekStartDay"],
	slashDiscovered: ["slash", "discovered"],
	notesRootId: ["notesRootId"],
};

/** Flag preferences kept in upstream's account settings rather than root metadata. */
const SETTINGS = {
	showCompleted: "show_completed",
	showKeyboardShortcuts: "show_keyboard_shortcuts",
	sameColorForLinks: "same_color_for_links",
} as const satisfies Record<string, ServerSetting>;

const SETTING_KEYS = ["showCompleted", "showKeyboardShortcuts", "sameColorForLinks"] as const;

/** Upstream sends flags as `"yes"`/`"no"`; the adapter caches a written flag as a boolean. */
function asFlag(value: unknown): boolean {
	return value === true || value === "yes";
}

function asString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

/** Read the preferences, treating missing or mistyped values as null (false for the flag). */
async function readPreferences(adapter: WorkflowyInternalAdapter): Promise<Preferences> {
	const [
		[dateFormat, timeFormat, weekStartDay, slashDiscovered, notesRootId],
		[showCompleted, showKeyboardShortcuts, sameColorForLinks],
	] = await Promise.all([
		Promise.all(KEYS.map(async (key) => adapter.getRootMeta(PATHS[key]))),
		Promise.all(SETTING_KEYS.map(async (key) => adapter.getSetting(SETTINGS[key]))),
	]);
	return {
		dateFormat: asString(dateFormat),
		timeFormat: asString(timeFormat),
		weekStartDay: typeof weekStartDay === "number" ? weekStartDay : null,
		slashDiscovered: slashDiscovered === true,
		notesRootId: asString(notesRootId),
		showCompleted: asFlag(showCompleted),
		showKeyboardShortcuts: asFlag(showKeyboardShortcuts),
		sameColorForLinks: asFlag(sameColorForLinks),
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
			for (const key of SETTING_KEYS) {
				const value = patch[key];
				if (value !== undefined) {
					await adapter.setSetting(SETTINGS[key], value);
				}
			}
			return c.json(await readPreferences(adapter));
		}),
	);

	return router;
}
