/**
 * The node wire shapes shared by the server ops that produce them and the client that consumes them. Each is inferred
 * from its output schema in `server/ops/schemas.ts` (or its op's module), so the client type cannot drift from what the ops answer.
 */

import type {z} from "zod";
import type {
	BacklinkCrumbSchema,
	BacklinkItemSchema,
	BacklinksResponseSchema,
	CalendarInfoSchema,
	ExpansionChangesResponseSchema,
	ExportTreeItemSchema,
	FoundDateItemSchema,
	FoundDatesResponseSchema,
	HomeResponseSchema,
	MirrorLocationSchema,
	MirrorsResponseSchema,
	NodeAttachmentSchema,
	NodeChangesResponseSchema,
	NodeListSchema,
	NodeResponseSchema,
	OutlineViewListSchema,
	OutlineViewResponseSchema,
	SaveEffectsSchema,
	SubtreeItemSchema,
	TableMetadataSchema,
	UpdateNodeResponseSchema,
} from "./server/ops/schemas.js";
import type {AppliedLayoutSchema, LayoutStepSchema} from "./server/ops/calendar.js";

export type NodeAttachment = z.output<typeof NodeAttachmentSchema>;
export type NodeResponse = z.output<typeof NodeResponseSchema>;
export type NodeListResponse = z.output<typeof NodeListSchema>;
export type TableMetadata = z.output<typeof TableMetadataSchema>;
export type CalendarInfo = z.output<typeof CalendarInfoSchema>;
export type BacklinkCrumb = z.output<typeof BacklinkCrumbSchema>;
export type BacklinkItem = z.output<typeof BacklinkItemSchema>;
export type BacklinksResponse = z.output<typeof BacklinksResponseSchema>;
export type OutlineViewList = z.output<typeof OutlineViewListSchema>;
export type OutlineViewResponse = z.output<typeof OutlineViewResponseSchema>;
export type NodeChangesResponse = z.output<typeof NodeChangesResponseSchema>;
export type ExpansionChangesResponse = z.output<typeof ExpansionChangesResponseSchema>;
export type SaveEffects = z.output<typeof SaveEffectsSchema>;
export type UpdateNodeResponse = z.output<typeof UpdateNodeResponseSchema>;
export type FoundDateItem = z.output<typeof FoundDateItemSchema>;
export type FoundDatesResponse = z.output<typeof FoundDatesResponseSchema>;
export type MirrorLocation = z.output<typeof MirrorLocationSchema>;
export type MirrorsResponse = z.output<typeof MirrorsResponseSchema>;
export type ExportTreeItem = z.output<typeof ExportTreeItemSchema>;
export type SubtreeItem = z.output<typeof SubtreeItemSchema>;
export type HomeResponse = z.output<typeof HomeResponseSchema>;
/** A planned restructure step of `POST /api/v1/calendar/layout/preview`. */
export type CalendarLayoutStep = z.output<typeof LayoutStepSchema>;
/** What `PUT /api/v1/calendar/layout` and its undo report. */
export type AppliedCalendarLayout = z.output<typeof AppliedLayoutSchema>;

/** One tree of a `POST /api/v1/nodes/trees` body. */
export interface BulkTree {
	name: string;
	note?: string | undefined;
	completed?: boolean | undefined;
	layoutMode?: string | undefined;
	numberedStart?: number | undefined;
	children?: BulkTree[] | undefined;
}
