import {and, eq, gte, inArray, lte, ne} from 'drizzle-orm';
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import {nodeContent, nodeMetadata} from '../db/schema.js';
import type * as schema from '../db/schema.js';
import {FAR_FUTURE_DATE, formatTemporalTimestamp} from '../temporal/constants.js';

const SQL_CHUNK_SIZE = 10_000;

export interface NodeChange {
	id: string;
	isNew: boolean;
	isDeleted: boolean;
	contentChanged: boolean;
	parentChanged: boolean;
	completionChanged: boolean;
	noteChanged: boolean;
	oldName: string | null;
	oldNote: string | null;
	oldParentId: string | null;
	oldCompletedAt: Date | null;
	currentName: string | null;
	currentNote: string | null;
	currentParentId: string | null;
	currentCompletedAt: Date | null;
	parentId: string | null;
}

export interface ChangeTreeNode {
	id: string;
	name: string | null;
	isContext: boolean;
	change: NodeChange | null;
	children: ChangeTreeNode[];
}

export interface ChangeSummary {
	added: number;
	deleted: number;
	changed: number;
	moved: number;
	completed: number;
	uncompleted: number;
}

export interface ChangeDetectionResult {
	changes: NodeChange[];
	tree: ChangeTreeNode[];
	summary: ChangeSummary;
	cutoffDate: Date;
}

export function getChangeLabels(change: NodeChange): string[] {
	const labels: string[] = [];

	if (change.isNew) {
		labels.push('Added');
		return labels;
	}

	if (change.isDeleted) {
		labels.push('Deleted');
		return labels;
	}

	if (change.completionChanged) {
		labels.push(change.currentCompletedAt ? 'Completed' : 'Uncompleted');
	}

	if (change.contentChanged && change.parentChanged) {
		labels.push('Changed and moved');
	} else if (change.contentChanged) {
		labels.push('Changed');
	} else if (change.parentChanged) {
		labels.push('Moved');
	}

	if (change.noteChanged && !change.contentChanged) {
		labels.push('Note edited');
	}

	return labels;
}

export class ChangeDetector {
	constructor(private readonly db: BetterSQLite3Database<typeof schema>) {}

	detectChanges(cutoffDate: Date): ChangeDetectionResult {
		const cutoffStr = formatTemporalTimestamp(cutoffDate);

		const oldContent = this.queryOldContent(cutoffStr);
		const newContent = this.queryNewContent(cutoffStr);
		const oldMeta = this.queryOldMetadata(cutoffStr);
		const newMeta = this.queryNewMetadata(cutoffStr);

		const changes = this.classifyChanges(oldContent, newContent, oldMeta, newMeta);
		const tree = this.buildChangeTree(changes);
		const summary = this.summarize(changes);

		return {changes, tree, summary, cutoffDate};
	}

	private queryOldContent(cutoffStr: string) {
		return this.db
			.select({
				id: nodeContent.id,
				name: nodeContent.name,
				note: nodeContent.note,
				parentId: nodeContent.parentId,
			})
			.from(nodeContent)
			.where(
				and(
					lte(nodeContent.systemFrom, cutoffStr),
					gte(nodeContent.systemTo, cutoffStr),
					ne(nodeContent.systemTo, FAR_FUTURE_DATE),
				),
			)
			.all();
	}

	private queryNewContent(cutoffStr: string) {
		return this.db
			.select({
				id: nodeContent.id,
				name: nodeContent.name,
				note: nodeContent.note,
				parentId: nodeContent.parentId,
			})
			.from(nodeContent)
			.where(and(gte(nodeContent.systemFrom, cutoffStr), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
			.all();
	}

	private queryOldMetadata(cutoffStr: string) {
		return this.db
			.select({
				nodeId: nodeMetadata.nodeId,
				completedAt: nodeMetadata.completedAt,
			})
			.from(nodeMetadata)
			.where(
				and(
					lte(nodeMetadata.systemFrom, cutoffStr),
					gte(nodeMetadata.systemTo, cutoffStr),
					ne(nodeMetadata.systemTo, FAR_FUTURE_DATE),
				),
			)
			.all();
	}

	private queryNewMetadata(cutoffStr: string) {
		return this.db
			.select({
				nodeId: nodeMetadata.nodeId,
				completedAt: nodeMetadata.completedAt,
			})
			.from(nodeMetadata)
			.where(and(gte(nodeMetadata.systemFrom, cutoffStr), eq(nodeMetadata.systemTo, FAR_FUTURE_DATE)))
			.all();
	}

	private classifyChanges(
		oldContent: {id: string; name: string | null; note: string | null; parentId: string | null}[],
		newContent: {id: string; name: string | null; note: string | null; parentId: string | null}[],
		oldMeta: {nodeId: string; completedAt: Date | null}[],
		newMeta: {nodeId: string; completedAt: Date | null}[],
	): NodeChange[] {
		const oldContentMap = new Map(oldContent.map((r) => [r.id, r]));
		const newContentMap = new Map(newContent.map((r) => [r.id, r]));
		const oldMetaMap = new Map(oldMeta.map((r) => [r.nodeId, r]));
		const newMetaMap = new Map(newMeta.map((r) => [r.nodeId, r]));

		const allIds = new Set([
			...newContentMap.keys(),
			...newMetaMap.keys(),
			...oldContentMap.keys(),
			...oldMetaMap.keys(),
		]);

		const changes: NodeChange[] = [];

		for (const id of allIds) {
			const oldC = oldContentMap.get(id);
			const newC = newContentMap.get(id);
			const oldM = oldMetaMap.get(id);
			const newM = newMetaMap.get(id);

			const hasContentChange = oldC !== undefined || newC !== undefined;
			const hasMetaChange = oldM !== undefined || newM !== undefined;

			if (!hasContentChange && !hasMetaChange) continue;

			const isNew = !oldC && !oldM && (Boolean(newC) || Boolean(newM));
			const isDeleted = (Boolean(oldC) || Boolean(oldM)) && !newC && !newM;

			let currentName: string | null = null;
			let currentNote: string | null = null;
			let currentParentId: string | null = null;

			if (newC) {
				currentName = newC.name;
				currentNote = newC.note;
				currentParentId = newC.parentId;
			} else if (!isDeleted) {
				const current = this.fetchCurrentContent(id);
				if (current) {
					currentName = current.name;
					currentNote = current.note;
					currentParentId = current.parentId;
				}
			}

			const oldName = oldC?.name ?? null;
			const oldNote = oldC?.note ?? null;
			const oldParentId = oldC?.parentId ?? null;
			const oldCompletedAt = oldM?.completedAt ?? null;
			const currentCompletedAt = newM?.completedAt ?? null;

			const nameChanged = oldC && newC ? oldC.name !== newC.name : false;
			const noteChanged = oldC && newC ? oldC.note !== newC.note : false;
			const parentChanged = oldC && newC ? oldC.parentId !== newC.parentId : false;

			const completionChanged =
				oldM !== undefined && newM !== undefined
					? (oldM.completedAt === null) !== (newM.completedAt === null)
					: false;

			const contentChanged = nameChanged;

			if (!isNew && !isDeleted && !contentChanged && !noteChanged && !parentChanged && !completionChanged)
				continue;

			changes.push({
				id,
				isNew,
				isDeleted,
				contentChanged: nameChanged,
				parentChanged,
				completionChanged,
				noteChanged,
				oldName,
				oldNote,
				oldParentId,
				oldCompletedAt,
				currentName,
				currentNote,
				currentParentId,
				currentCompletedAt,
				parentId: isDeleted ? oldParentId : currentParentId,
			});
		}

		return changes;
	}

	private fetchCurrentContent(id: string) {
		return this.db
			.select({
				name: nodeContent.name,
				note: nodeContent.note,
				parentId: nodeContent.parentId,
			})
			.from(nodeContent)
			.where(and(eq(nodeContent.id, id), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
			.get();
	}

	buildChangeTree(changes: NodeChange[]): ChangeTreeNode[] {
		const changeMap = new Map(changes.map((c) => [c.id, c]));

		const nodeInfoMap = new Map<string, {name: string | null; parentId: string | null}>();

		for (const change of changes) {
			nodeInfoMap.set(change.id, {
				name: change.isDeleted ? change.oldName : change.currentName,
				parentId: change.parentId,
			});
		}

		const parentIds = new Set<string>();
		for (const change of changes) {
			if (change.parentId) {
				parentIds.add(change.parentId);
			}
		}

		let currentIds = [...parentIds].filter((id) => !nodeInfoMap.has(id));

		while (currentIds.length > 0) {
			const nextIds: string[] = [];

			for (let i = 0; i < currentIds.length; i += SQL_CHUNK_SIZE) {
				const chunk = currentIds.slice(i, i + SQL_CHUNK_SIZE);
				const results = this.db
					.select({
						id: nodeContent.id,
						name: nodeContent.name,
						parentId: nodeContent.parentId,
					})
					.from(nodeContent)
					.where(and(inArray(nodeContent.id, chunk), eq(nodeContent.systemTo, FAR_FUTURE_DATE)))
					.all();

				for (const row of results) {
					if (!nodeInfoMap.has(row.id)) {
						nodeInfoMap.set(row.id, {name: row.name, parentId: row.parentId});
						if (row.parentId && !nodeInfoMap.has(row.parentId)) {
							nextIds.push(row.parentId);
						}
					}
				}
			}

			currentIds = [...new Set(nextIds)];
		}

		const childrenMap = new Map<string | null, string[]>();
		for (const [id, info] of nodeInfoMap) {
			const pid = info.parentId;
			if (!childrenMap.has(pid)) {
				childrenMap.set(pid, []);
			}
			childrenMap.get(pid)!.push(id);
		}

		const buildNode = (id: string): ChangeTreeNode | null => {
			const info = nodeInfoMap.get(id);
			if (!info) return null;

			const childIds = childrenMap.get(id) ?? [];
			const children = childIds
				.map((childId) => buildNode(childId))
				.filter((n): n is ChangeTreeNode => n !== null);

			const change = changeMap.get(id) ?? null;
			const isContext = change === null;

			if (isContext && children.length === 0) return null;

			return {
				id,
				name: info.name,
				isContext,
				change,
				children,
			};
		};

		const rootChildIds = childrenMap.get(null) ?? [];
		return rootChildIds.map((childId) => buildNode(childId)).filter((n): n is ChangeTreeNode => n !== null);
	}

	private summarize(changes: NodeChange[]): ChangeSummary {
		const summary: ChangeSummary = {
			added: 0,
			deleted: 0,
			changed: 0,
			moved: 0,
			completed: 0,
			uncompleted: 0,
		};

		for (const c of changes) {
			if (c.isNew) summary.added++;
			else if (c.isDeleted) summary.deleted++;
			else {
				if (c.contentChanged || c.noteChanged) summary.changed++;
				if (c.parentChanged) summary.moved++;
				if (c.completionChanged) {
					if (c.currentCompletedAt) summary.completed++;
					else summary.uncompleted++;
				}
			}
		}

		return summary;
	}
}
