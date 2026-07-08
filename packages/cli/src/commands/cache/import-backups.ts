import {backupImports} from '@workflowy/shared/db';
import {FAR_FUTURE_DATE} from '@workflowy/shared/temporal';
import {Command, Flags} from '@oclif/core';
import {desc, eq} from 'drizzle-orm';
import {createDatabase} from '../../db/index.js';
import {logger} from '../../services/logger.js';
import path from 'node:path';
import {type BackupEntry, listBackups, materializeBackup} from '../../utils/backup-archive.js';
import {formatDate, getDateDifference} from '../../utils/backup-validation.js';

export default class ImportBackups extends Command {
	static override description = 'Import all missing backups from Dropbox into cache';

	static override examples = [
		'<%= config.bin %> cache:import-backups',
		'<%= config.bin %> cache:import-backups --no-embeddings',
		'<%= config.bin %> cache:import-backups --batch-size 50',
	];

	static override flags = {
		embeddings: Flags.boolean({
			description: 'Generate embeddings after import',
			default: true,
			allowNo: true,
		}),
		'batch-size': Flags.integer({
			char: 'b',
			description: 'Number of nodes to process in each embedding batch',
			default: 20,
		}),
	};

	public async run(): Promise<void> {
		const {flags} = await this.parse(ImportBackups);

		const db = createDatabase();
		const backupsDirectory = path.join(process.cwd(), 'backups');

		const mostRecentImport = db
			.select()
			.from(backupImports)
			.where(eq(backupImports.systemTo, FAR_FUTURE_DATE))
			.orderBy(desc(backupImports.backupDate))
			.limit(1)
			.get();
		logger.logSqlResult('import-backups.mostRecentImport', mostRecentImport);

		this.log('📥 Downloading any missing backups from Dropbox...');
		await this.executeCommand('dropbox', ['download-backup']);

		this.log('🗜️  Compressing and archiving local backups...');
		await this.executeCommand('backups', ['archive']);

		const localBackups = listBackups(backupsDirectory);

		if (localBackups.length === 0) {
			this.log('❌ No backup files found');
			return;
		}

		const lastImportDate = mostRecentImport ? new Date(mostRecentImport.backupDate) : null;
		if (lastImportDate) {
			this.log(`📅 Last import: ${formatDate(lastImportDate)}`);
		}

		const unimportedBackups = lastImportDate
			? localBackups.filter((backup) => backup.backupDate > lastImportDate)
			: localBackups;

		if (unimportedBackups.length === 0) {
			this.log('✅ Already up to date!');
			if (flags.embeddings) {
				this.log('\n🤖 Generating embeddings for any nodes without them...');
				await this.executeCommand('ai', ['embed', '--batch-size', flags['batch-size'].toString()]);
			}
			return;
		}

		if (lastImportDate && unimportedBackups.length > 0) {
			const firstUnimported = unimportedBackups[0]!;
			const daysDiff = getDateDifference(lastImportDate, firstUnimported.backupDate);
			if (daysDiff > 1) {
				this.log(
					`⚠️  Gap: ${daysDiff - 1} day(s) between last import (${formatDate(lastImportDate)}) and first unimported backup (${formatDate(firstUnimported.backupDate)})`,
				);
			}
		}

		this.log(`\n📦 Importing ${unimportedBackups.length} backup(s)...\n`);

		for (const backup of unimportedBackups) {
			this.log(`📦 Importing: ${formatDate(backup.backupDate)}`);
			await this.importBackup(backup, flags);
		}

		this.log('\n✅ Import complete!');
	}

	private async importBackup(backup: BackupEntry, flags: {embeddings: boolean; 'batch-size': number}): Promise<void> {
		// Archived backups live inside a solid `.tar.zst`; materializeBackup extracts
		// them to a temp file so the path-based cache:import-backup command can run.
		const {filePath, cleanup} = materializeBackup(backup.location);

		try {
			const importArgs = [
				'import-backup',
				'--file',
				filePath,
				'--yes',
				'--batch-size',
				flags['batch-size'].toString(),
			];
			if (!flags.embeddings) {
				importArgs.push('--no-embeddings');
			}
			await this.executeCommand('cache', importArgs);
		} finally {
			cleanup();
		}
	}

	private async executeCommand(topic: string, args: string[]): Promise<void> {
		const {default: Command} = await import(`../${topic}/${args[0]}.js`);
		await Command.run(args.slice(1));
	}
}
