/**
 * Detection and ordering rules for photo-paste groups in the Workflowy calendar.
 *
 * Pasting several photos at once produces two defects: Workflowy sometimes wraps
 * them in an extra blank node, and it lists them in reverse order. This module is
 * the pure half of the fix — it turns flat cache rows into groups and decides what
 * order each group belongs in. All I/O lives in the `calendar:fix-photo-groups`
 * command.
 */

/** A node row as read from the cache, with its attachment details joined in. */
export interface CachedNodeRow {
	id: string;
	parentId: string | null;
	name: string | null;
	note: string | null;
	priority: number;
	childCount: number;
	/** Creation time in epoch seconds, or null when unknown. */
	createdAt: number | null;
	/** True when the node is a mirror; mirrors render blank but hold no photo. */
	isMirror: boolean;
	/** Filename of the node's attachment, or null when unknown. */
	fileName: string | null;
	/** MIME type of the node's attachment, or null when unknown. */
	fileType: string | null;
}

export interface PhotoGroupMember {
	id: string;
	priority: number;
	createdAt: number | null;
	fileName: string | null;
	fileType: string | null;
}

export interface PhotoGroup {
	/** `wrapped` photos sit inside a blank node; `loose` ones hang off the entry. */
	kind: 'wrapped' | 'loose';
	/** The calendar entry the photos should end up under. */
	entryId: string;
	/** The blank wrapper to delete once emptied, or null for loose groups. */
	wrapperId: string | null;
	/** Members in current display order (by priority). */
	members: PhotoGroupMember[];
}

export interface PhotoGroupPlan {
	decision: 'reverse' | 'already-ordered' | 'unverifiable';
	reason: string;
	/** Members in the order they should appear once fixed. */
	orderedIds: string[];
}

const MINIMUM_GROUP_SIZE = 2;

/**
 * Seconds of spread allowed across a group's creation times. One paste stamps
 * every photo with the same second; a wider spread means separate pastes, whose
 * relative order carries no information.
 */
const PASTE_WINDOW_SECONDS = 300;

const IMAGE_SEQUENCE_PATTERN = /^IMG_(\d+)\./i;

/**
 * Extract the sequence number from an iPhone-style `IMG_3695.jpeg` filename.
 * These numbers increase with capture time, so they are the only chronological
 * evidence available — the cache stores no EXIF data.
 */
export function parseImageSequence(fileName: string | null): number | null {
	if (!fileName) return null;
	const match = IMAGE_SEQUENCE_PATTERN.exec(fileName);
	return match ? Number.parseInt(match[1], 10) : null;
}

function isBlank(value: string | null): boolean {
	return (value ?? '').trim() === '';
}

/**
 * A photo node renders blank and holds no children. Mirrors also render blank in
 * the cache — they take their text from the original — so they are excluded here.
 */
function isBlankLeaf(row: CachedNodeRow): boolean {
	return isBlank(row.name) && isBlank(row.note) && row.childCount === 0 && !row.isMirror;
}

function toMember(row: CachedNodeRow): PhotoGroupMember {
	return {
		id: row.id,
		priority: row.priority,
		createdAt: row.createdAt,
		fileName: row.fileName,
		fileType: row.fileType,
	};
}

/** Groups need at least one confirmed image; blank leaves alone prove nothing. */
function hasImageEvidence(members: PhotoGroupMember[]): boolean {
	return members.some((member) => member.fileType?.startsWith('image/') ?? false);
}

function byPriority(a: {priority: number}, b: {priority: number}): number {
	return a.priority - b.priority;
}

/**
 * Group blank photo nodes into wrapped groups (a blank node holding only blank
 * leaves) and loose groups (a run of adjacent blank leaves under a real entry).
 */
export function buildPhotoGroups(rows: CachedNodeRow[]): PhotoGroup[] {
	const childrenByParent = new Map<string, CachedNodeRow[]>();
	for (const row of rows) {
		if (!row.parentId) continue;
		const siblings = childrenByParent.get(row.parentId) ?? [];
		siblings.push(row);
		childrenByParent.set(row.parentId, siblings);
	}
	for (const siblings of childrenByParent.values()) {
		siblings.sort(byPriority);
	}

	const groups: PhotoGroup[] = [];

	for (const row of rows) {
		const children = childrenByParent.get(row.id) ?? [];

		const isWrapper =
			isBlank(row.name) &&
			isBlank(row.note) &&
			row.parentId !== null &&
			children.length >= MINIMUM_GROUP_SIZE &&
			children.every((child) => isBlankLeaf(child));

		if (isWrapper) {
			const members = children.map((child) => toMember(child));
			if (hasImageEvidence(members)) {
				groups.push({
					kind: 'wrapped',
					entryId: row.parentId as string,
					wrapperId: row.id,
					members,
				});
			}
			continue;
		}

		if (isBlank(row.name)) continue;

		let run: CachedNodeRow[] = [];
		for (const child of [...children, null]) {
			if (child && isBlankLeaf(child)) {
				run.push(child);
				continue;
			}
			if (run.length >= MINIMUM_GROUP_SIZE) {
				const members = run.map((member) => toMember(member));
				if (hasImageEvidence(members)) {
					groups.push({kind: 'loose', entryId: row.id, wrapperId: null, members});
				}
			}
			run = [];
		}
	}

	return groups;
}

/** Decide what order a group's photos belong in, and whether to touch it at all. */
export function planPhotoGroup(group: PhotoGroup): PhotoGroupPlan {
	const members = [...group.members].sort(byPriority);
	const currentIds = members.map((member) => member.id);
	const reversedIds = [...currentIds].reverse();

	const timestamps = members.map((member) => member.createdAt).filter((value): value is number => value !== null);
	if (
		timestamps.length === members.length &&
		Math.max(...timestamps) - Math.min(...timestamps) > PASTE_WINDOW_SECONDS
	) {
		return {decision: 'unverifiable', reason: 'photos were added at different times', orderedIds: currentIds};
	}

	const sequences = members.map((member) => parseImageSequence(member.fileName));
	if (sequences.every((sequence) => sequence !== null)) {
		const numbers = sequences as number[];
		const descending = numbers.every((value, index) => index === 0 || numbers[index - 1] > value);
		if (descending) {
			return {decision: 'reverse', reason: 'filenames descend', orderedIds: reversedIds};
		}

		const ascending = numbers.every((value, index) => index === 0 || numbers[index - 1] < value);
		if (ascending) {
			return {decision: 'already-ordered', reason: 'filenames ascend', orderedIds: currentIds};
		}

		return {decision: 'unverifiable', reason: 'filenames are not monotonic', orderedIds: currentIds};
	}

	if (group.kind === 'wrapped') {
		return {
			decision: 'reverse',
			reason: 'wrapped group, assuming a single reversed paste',
			orderedIds: reversedIds,
		};
	}

	return {decision: 'unverifiable', reason: 'loose group without filename evidence', orderedIds: currentIds};
}
