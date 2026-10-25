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
import {reapplyWeekLayout} from "../calendar-layout.js";
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
		theme: z.string(),
		displayImagePreviewsAsThumbnails: z.boolean(),
		ignoreYoutube: z.boolean(),
		ignoreYtShort: z.boolean(),
		ignoreTwitter: z.boolean(),
		ignoreLoom: z.boolean(),
		unsubscribeFromSummaryEmails: z.boolean(),
		unsubscribeFromCommentsEmails: z.boolean(),
		weeklyReportOn: z.boolean(),
	})
	.partial()
	.strict();

type PreferencesPatch = z.infer<typeof PreferencesPatchSchema>;
type Preferences = Required<Omit<PreferencesPatch, "theme">> & {
	theme: string | null;
	/** The signed-in account's name and email (read-only), null unless both are known. */
	account: {username: string; email: string} | null;
};

const KEYS = ["dateFormat", "timeFormat", "weekStartDay", "slashDiscovered", "notesRootId", "weeklyReportOn"] as const;

/** Each root-metadata preference's path. */
const PATHS: Record<(typeof KEYS)[number], string[]> = {
	dateFormat: ["dateFormat"],
	timeFormat: ["timeFormat"],
	weekStartDay: ["weekStartDay"],
	slashDiscovered: ["slash", "discovered"],
	notesRootId: ["notesRootId"],
	weeklyReportOn: ["weekly-report", "on"],
};

/** Flag preferences kept in upstream's account settings rather than root metadata. */
const SETTINGS = {
	showCompleted: "show_completed",
	showKeyboardShortcuts: "show_keyboard_shortcuts",
	sameColorForLinks: "same_color_for_links",
	displayImagePreviewsAsThumbnails: "display_image_previews_as_thumbnails",
	ignoreYoutube: "ignore_youtube",
	ignoreYtShort: "ignore_yt_short",
	ignoreTwitter: "ignore_twitter",
	ignoreLoom: "ignore_loom",
	unsubscribeFromSummaryEmails: "unsubscribe_from_summary_emails",
	unsubscribeFromCommentsEmails: "unsubscribe_from_comments_emails",
} as const satisfies Record<string, ServerSetting>;

const FLAG_KEYS = [
	"showCompleted",
	"showKeyboardShortcuts",
	"sameColorForLinks",
	"displayImagePreviewsAsThumbnails",
	"ignoreYoutube",
	"ignoreYtShort",
	"ignoreTwitter",
	"ignoreLoom",
	"unsubscribeFromSummaryEmails",
	"unsubscribeFromCommentsEmails",
] as const;

/** The server-saved settings that are strings rather than yes/no flags. */
const STRING_SETTINGS = {theme: "theme"} as const satisfies Record<string, ServerSetting>;

/** Upstream sends flags as `"yes"`/`"no"`; the adapter caches a written flag as a boolean. */
function asFlag(value: unknown): boolean {
	return value === true || value === "yes";
}

function asString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

/** Read the preferences, treating missing or mistyped values as null (false for the flag). */
async function readPreferences(adapter: WorkflowyInternalAdapter): Promise<Preferences> {
	const [rootValues, flagValues, theme, username, email] = await Promise.all([
		Promise.all(KEYS.map(async (key) => adapter.getRootMeta(PATHS[key]))),
		Promise.all(FLAG_KEYS.map(async (key) => adapter.getSetting(SETTINGS[key]))),
		adapter.getSetting(STRING_SETTINGS.theme),
		adapter.getSetting("username"),
		adapter.getSetting("email"),
	]);
	const root = Object.fromEntries(KEYS.map((key, index) => [key, rootValues[index]]));
	const flag = (key: (typeof FLAG_KEYS)[number]): boolean => asFlag(flagValues[FLAG_KEYS.indexOf(key)]);
	const name = asString(username);
	const address = asString(email);
	return {
		dateFormat: asString(root.dateFormat),
		timeFormat: asString(root.timeFormat),
		weekStartDay: typeof root.weekStartDay === "number" ? root.weekStartDay : null,
		slashDiscovered: root.slashDiscovered === true,
		notesRootId: asString(root.notesRootId),
		weeklyReportOn: root.weeklyReportOn === true,
		showCompleted: flag("showCompleted"),
		showKeyboardShortcuts: flag("showKeyboardShortcuts"),
		sameColorForLinks: flag("sameColorForLinks"),
		displayImagePreviewsAsThumbnails: flag("displayImagePreviewsAsThumbnails"),
		ignoreYoutube: flag("ignoreYoutube"),
		ignoreYtShort: flag("ignoreYtShort"),
		ignoreTwitter: flag("ignoreTwitter"),
		ignoreLoom: flag("ignoreLoom"),
		unsubscribeFromSummaryEmails: flag("unsubscribeFromSummaryEmails"),
		unsubscribeFromCommentsEmails: flag("unsubscribeFromCommentsEmails"),
		theme: asString(theme),
		account: name !== null && address !== null ? {username: name, email: address} : null,
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
			const previousWeekStartDay =
				patch.weekStartDay === undefined ? undefined : await adapter.getRootMeta(PATHS.weekStartDay);
			const changes = KEYS.filter((key) => key in patch).map((key) => ({
				path: PATHS[key],
				value: patch[key] ?? undefined,
			}));
			if (changes.length > 0) {
				await adapter.setRootMetaValues(changes);
				// The durable local copy, so the value outlives workflowy.com.
				adapter.saveLocalSettings(
					Object.fromEntries(
						KEYS.filter((key) => key in patch).map((key) => [`root:${key}`, patch[key] ?? null]),
					),
				);
			}
			for (const key of FLAG_KEYS) {
				const value = patch[key];
				if (value !== undefined) {
					await adapter.setSetting(SETTINGS[key], value);
				}
			}
			if (patch.theme !== undefined) {
				await adapter.setSetting(STRING_SETTINGS.theme, patch.theme);
			}
			if (
				patch.weekStartDay !== undefined &&
				(patch.weekStartDay ?? undefined) !== (previousWeekStartDay ?? undefined)
			) {
				await reapplyWeekLayout(c.get("ctx"), adapter);
			}
			return c.json(await readPreferences(adapter));
		}),
	);

	return router;
}
