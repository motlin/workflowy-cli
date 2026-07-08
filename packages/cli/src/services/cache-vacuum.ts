import * as schema from '@workflowy/shared/db';
import {sql} from 'drizzle-orm';
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type VacuumResult = {
	path: string;
	sizeBeforeBytes: number;
	sizeAfterBytes: number;
	freelistBefore: number;
	freelistAfter: number;
};

export class CacheVacuumService {
	private database: BetterSQLite3Database<typeof schema>;

	constructor(database: BetterSQLite3Database<typeof schema>) {
		this.database = database;
	}

	vacuum(): VacuumResult {
		const dbPath = path.resolve(process.env.WORKFLOWY_DB_PATH || 'workflowy.sqlite');

		const sizeBeforeBytes = this.getFileSize(dbPath);
		const freelistBefore = this.getFreelistCount();

		this.database.run(sql.raw('VACUUM'));

		const sizeAfterBytes = this.getFileSize(dbPath);
		const freelistAfter = this.getFreelistCount();

		return {
			path: dbPath,
			sizeBeforeBytes,
			sizeAfterBytes,
			freelistBefore,
			freelistAfter,
		};
	}

	private getFreelistCount(): number {
		const row = this.database.get<{freelist_count: number}>(sql.raw('PRAGMA freelist_count'));
		return row?.freelist_count ?? 0;
	}

	private getFileSize(dbPath: string): number {
		if (!fs.existsSync(dbPath)) {
			return 0;
		}

		return fs.statSync(dbPath).size;
	}
}

export function formatBytes(sizeInBytes: number): string {
	if (sizeInBytes < 1024) {
		return `${sizeInBytes} bytes`;
	}

	if (sizeInBytes < 1024 * 1024) {
		return `${(sizeInBytes / 1024).toFixed(2)} KB`;
	}

	return `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`;
}
