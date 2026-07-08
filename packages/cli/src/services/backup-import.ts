import {BackupFileSchema} from '@workflowy/shared/schemas';
import {createDatabase} from '../db/index.js';
import {CacheService} from './cache.js';
import {EmbeddingGeneratorService} from './embedding-generator.js';
import {readBackupFile} from '../utils/backup-archive.js';
import path from 'node:path';

export type BackupImportStats = {
	totalNodes: number;
	nodesAdded: number;
	nodesUpdated: number;
	nodesUnchanged: number;
	nodesDeleted: number;
	nodesPhasedOut: number;
	contentUpdated: number;
	metadataUpdated: number;
	priorityUpdated: number;
	importTimestamp: Date;
	skipped?: boolean;
	skipReason?: string;
	localWatermark?: string | null;
	incomingWatermark?: string | null;
};

export type BackupFileNode = {
	ch?: Array<unknown>;
};

export type BackupImportProgress = {
	phase: 'parsing' | 'importing' | 'embeddings';
	current: number;
	total: number;
	message?: string;
};

export type BackupImportOptions = {
	filePath: string;
	generateEmbeddings?: boolean;
	embeddingBatchSize?: number;
	force?: boolean;
	onProgress?: (progress: BackupImportProgress) => void;
};

export class BackupImportService {
	private database: ReturnType<typeof createDatabase>;
	private cacheService: CacheService;

	constructor(database: ReturnType<typeof createDatabase>) {
		this.database = database;
		this.cacheService = new CacheService(database);
	}

	async importBackup(options: BackupImportOptions): Promise<BackupImportStats> {
		const {filePath, generateEmbeddings = false, embeddingBatchSize = 20, force = false, onProgress} = options;

		const fileContent = readBackupFile(filePath);
		const rootNodes = BackupFileSchema.parse(JSON.parse(fileContent));

		const nodeCount = this.countNodes(rootNodes);
		onProgress?.({
			phase: 'parsing',
			current: nodeCount,
			total: nodeCount,
		});

		onProgress?.({
			phase: 'importing',
			current: 0,
			total: nodeCount,
			message: 'Processing nodes...',
		});

		const filename = path.basename(filePath);
		const stats = await this.cacheService.importBackup(filePath, filename, false, force);

		if (generateEmbeddings && !stats.skipped) {
			await this.generateEmbeddingsForImport(embeddingBatchSize, onProgress);
		}

		return stats;
	}

	countNodes(rootNodes: BackupFileNode[]): number {
		let count = rootNodes.length;
		for (const node of rootNodes) {
			if (node.ch && Array.isArray(node.ch)) {
				count += this.countNodes(node.ch as BackupFileNode[]);
			}
		}
		return count;
	}

	private async generateEmbeddingsForImport(
		batchSize: number,
		onProgress?: (progress: BackupImportProgress) => void,
	): Promise<void> {
		const embeddingGenerator = new EmbeddingGeneratorService(this.database);
		const result = await embeddingGenerator.generateEmbeddings({batchSize, force: false}, (progress) => {
			onProgress?.({
				phase: 'embeddings',
				current: progress.processed,
				total: progress.total,
				message: progress.message ?? `[${progress.currentModel}] ${progress.processed}/${progress.total}`,
			});
		});

		onProgress?.({
			phase: 'embeddings',
			current: result.totalProcessed,
			total: result.totalProcessed,
			message: `Generated embeddings for ${result.totalProcessed} nodes across all models`,
		});
	}
}
