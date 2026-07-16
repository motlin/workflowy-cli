/**
 * File-attachment metadata for a node, sourced from the `s3_files` cache table.
 */
export interface NodeAttachment {
	fileName: string;
	fileType: string;
	objectFolder: string | null;
	imageOriginalWidth: number | null;
	imageOriginalHeight: number | null;
	isDeleted: boolean;
}

/**
 * A node in Workflowy REST API response shape (snake_case wire format), shared by
 * the server routes that produce it and the client that consumes it.
 *
 * The derived/mirror fields are optional so client-side optimistic constructions
 * need not populate them; the server always sets them.
 */
export interface NodeResponse {
	id: string;
	parent_id: string | null;
	name: string | null;
	note: string | null;
	priority: number;
	data: {layoutMode: string | null};
	createdAt: number | null;
	modifiedAt: number | null;
	completedAt: number | null;
	hasChildren?: boolean;
	isMirror?: boolean;
	originalNodeId?: string | null;
	attachment?: NodeAttachment | null;
}
