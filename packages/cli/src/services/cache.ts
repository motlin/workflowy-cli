import {CacheService as BaseCacheService} from '@workflowy/shared/cache';
import type {Node} from '@workflowy/shared/types';
import {importBackup, type ImportBackupResult} from './cache-import.js';
import {logger} from './logger.js';

/**
 * CLI-specific CacheService that extends the shared CacheService with
 * backup import functionality. This functionality requires Node.js fs
 * module, so it cannot be included in the shared package.
 */
export class CacheService extends BaseCacheService {
	/**
	 * Import nodes from a Workflowy backup file
	 * @param filePath Path to the backup JSON file
	 * @param backupImportFilename Filename of the backup being imported
	 * @param verbose Show detailed timing information
	 * @param force Bypass the stale-snapshot watermark guard
	 */
	async importBackup(
		filePath: string,
		backupImportFilename: string,
		verbose = false,
		force = false,
	): Promise<ImportBackupResult> {
		return importBackup(this.database, filePath, backupImportFilename, verbose, undefined, force);
	}

	async getNode(nodeId: string): Promise<Node | undefined> {
		const result = await super.getNode(nodeId);
		logger.logSqlResult('getNode', result);
		return result;
	}

	async getChildren(parentId: string | null): Promise<Node[]> {
		const results = await super.getChildren(parentId);
		logger.logSqlResult('getChildren', results);
		return results;
	}

	async getChildrenWithMergedData(
		parentId: string | null,
	): Promise<Awaited<ReturnType<BaseCacheService['getChildrenWithMergedData']>>> {
		const result = await super.getChildrenWithMergedData(parentId);
		logger.logSqlResult('getChildrenWithMergedData', result);
		return result;
	}

	async getChildrenForMultipleParents(
		parentIds: string[],
	): Promise<Awaited<ReturnType<BaseCacheService['getChildrenForMultipleParents']>>> {
		const result = await super.getChildrenForMultipleParents(parentIds);
		logger.logSqlResult('getChildrenForMultipleParents', result);
		return result;
	}

	async getMirrorOriginal(nodeId: string) {
		const result = await super.getMirrorOriginal(nodeId);
		logger.logSqlResult('getMirrorOriginal', result);
		return result;
	}
}
