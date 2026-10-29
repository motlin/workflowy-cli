/** Output schemas shared by several ops. Tests parse op values against them; production never does. */

import {z} from "zod";

const NodeAttachmentSchema = z.strictObject({
	fileName: z.string(),
	fileType: z.string(),
	objectFolder: z.string().nullable(),
	imageOriginalWidth: z.number().nullable(),
	imageOriginalHeight: z.number().nullable(),
	imageOriginalPixels: z.number().nullable(),
	isAnimatedGif: z.boolean(),
	isDeleted: z.boolean(),
});

const TableMetadataSchema = z.strictObject({
	headers: z.boolean().optional(),
	skipHeaders: z.boolean().optional(),
	sizes: z.record(z.string(), z.number()).optional(),
	bg: z.string().optional(),
});

const CalendarInfoSchema = z.strictObject({
	level: z.string().nullable(),
	dateId: z.number().nullable(),
	root: z.boolean(),
	foundDates: z.boolean().nullable(),
	dayPrefix: z.boolean().nullable(),
	restorableUniqueNode: z.boolean(),
});

/** A node as `GET /nodes/:id` answers it: {@link import("../../node-types.js").NodeResponse} after a JSON round trip. */
export const NodeResponseSchema = z.strictObject({
	id: z.string(),
	parent_id: z.string().nullable(),
	name: z.string().nullable(),
	note: z.string().nullable(),
	priority: z.number(),
	data: z.strictObject({layoutMode: z.string().nullable()}),
	numberedStart: z.number().nullable().optional(),
	createdAt: z.number().nullable(),
	modifiedAt: z.number().nullable(),
	completedAt: z.number().nullable(),
	hasChildren: z.boolean().optional(),
	hasUncompletedChildren: z.boolean().optional(),
	readOnly: z.boolean().optional(),
	isMirror: z.boolean().optional(),
	hasMirrors: z.boolean().optional(),
	originalNodeId: z.string().nullable().optional(),
	attachment: NodeAttachmentSchema.nullable().optional(),
	defaultToBottom: z.boolean().optional(),
	table: TableMetadataSchema.nullable().optional(),
	isReferencesRoot: z.boolean().optional(),
	backlinksLabel: z.string().optional(),
	calendar: CalendarInfoSchema.nullable().optional(),
});

/** A value-less success: `null`, answered as 204. */
export const NoContentSchema = z.null();
