import {backupImports} from '@workflowy/shared/db';
import {FAR_FUTURE_DATE} from '@workflowy/shared/temporal';
import {Command, Flags} from '@oclif/core';
import {and, desc, eq} from 'drizzle-orm';
import {logger} from '../../services/logger.js';
import fs from 'node:fs';
import path from 'node:path';
import {resolveBackupsDirectory} from '../../utils/backup-archive.js';
import * as readline from 'node:readline/promises';
import {createDatabase} from '../../db/index.js';
import {type BackupImportProgress, BackupImportService} from '../../services/backup-import.js';
import {formatDate, getDateDifference, parseBackupFilename} from '../../utils/backup-validation.js';

export default class ImportBackup extends Command {
	static override description = 'Import a Workflowy backup file into the cache database';

	static override examples = [
		'<%= config.bin %> cache:import-backup --file backup.json',
		'<%= config.bin %> cache:import-backup --file /path/to/backup.workflowy.backup',
		'<%= config.bin %> cache:import-backup --file backup.json --no-embeddings',
		'<%= config.bin %> cache:import-backup --latest',
	];

	static override flags = {
		file: Flags.string({
			char: 'f',
			description: 'Path to the backup file',
			required: false,
		}),
		latest: Flags.boolean({
			description: 'Import the most recent backup file from current directory',
			default: false,
		}),
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
		yes: Flags.boolean({
			char: 'y',
			description: 'Skip confirmation prompts',
			default: false,
		}),
		force: Flags.boolean({
			description:
				'Take the snapshot verbatim: do not protect cached nodes newer than it, tombstoning anything it omits',
			default: false,
		}),
	};

	public async run(): Promise<void> {
		const {flags} = await this.parse(ImportBackup);

		if (flags.latest && flags.file) {
			this.error('Cannot use both --latest and --file flags');
		}

		if (!flags.latest && !flags.file) {
			this.error('Either --file or --latest flag is required');
		}

		let filePath: string;

		if (flags.latest) {
			filePath = this.findLatestBackupFile();
			this.log(`Found latest backup: ${filePath}`);
		} else {
			filePath = path.resolve(flags.file!);
		}

		if (!fs.existsSync(filePath)) {
			this.error(`File not found: ${filePath}`);
		}

		// Validate file is readable
		try {
			fs.accessSync(filePath, fs.constants.R_OK);
		} catch {
			this.error(`File is not readable: ${filePath}`);
		}

		const parsedBackupInfo = parseBackupFilename(filePath);

		const stats = fs.statSync(filePath);
		const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

		this.log(`Importing backup file: ${filePath} (${fileSizeMB} MB)`);
		if (parsedBackupInfo) {
			this.log(`Backup date: ${parsedBackupInfo.backupDate.toISOString()}`);
		}

		const startTime = Date.now();

		try {
			const db = createDatabase();
			if (parsedBackupInfo) {
				await this.validateBackupOrder(db, parsedBackupInfo, flags.yes);
				const alreadyImported = await this.checkIfAlreadyImported(db, parsedBackupInfo.filename);
				if (alreadyImported) {
					this.log(`✓ Backup already imported: ${parsedBackupInfo.filename}`);
					return;
				}
			}

			const importService = new BackupImportService(db);

			const handleProgress = (progress: BackupImportProgress) => {
				switch (progress.phase) {
					case 'parsing': {
						break;
					}
					case 'importing': {
						this.log('Processing nodes...');

						break;
					}
					case 'embeddings': {
						if (progress.message?.startsWith('📊')) {
							this.log(`\n🤖 ${progress.message}`);
						} else if (progress.message?.startsWith('🔄')) {
							this.log(`  ${progress.message}`);
						} else if (progress.message?.startsWith('✅ Finished')) {
							this.log(`  ${progress.message}`);
						} else if (progress.message?.includes('Initializing')) {
							this.log('\n🤖 Initializing embedding model...');
						} else if (progress.message?.includes('Generated embeddings')) {
							const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
							this.log(`\n✅ ${progress.message} in ${totalTime}s`);
							this.log(`\n🔍 You can now search with: workflowy search --query "your query"`);
						} else if (progress.message?.includes('Failed')) {
							this.warn(progress.message);
						} else if (progress.current > 0 && progress.current % 10 === 0) {
							const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
							const rate = (progress.current / (Date.now() - startTime)) * 1000;
							const remaining = Math.ceil((progress.total - progress.current) / rate);
							this.log(
								`  [${progress.message?.match(/\[(.*?)\]/)?.[1] ?? 'embedding'}] ${progress.current}/${progress.total} (${elapsed}s elapsed, ~${remaining}s remaining)`,
							);
						}

						break;
					}
					// No default
				}
			};

			const stats = await importService.importBackup({
				filePath,
				generateEmbeddings: flags.embeddings,
				embeddingBatchSize: flags['batch-size'],
				force: flags.force,
				onProgress: handleProgress,
			});

			const importElapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);

			if (stats.nodesPreserved > 0) {
				this.log(
					`\n🛡  Snapshot predates the cache (snapshot ${stats.incomingWatermark}, cache ${stats.localWatermark}); ` +
						`kept ${stats.nodesPreserved.toLocaleString()} newer node(s) it does not describe.`,
				);
			}

			const changedCount = stats.nodesAdded + stats.nodesUpdated + stats.nodesDeleted;
			if (changedCount === 0) {
				this.log(`✓ No changes (${stats.totalNodes.toLocaleString()} nodes in ${importElapsedSeconds}s)`);
			} else {
				this.log(
					`✓ +${stats.nodesAdded.toLocaleString()} added, ` +
						`~${stats.nodesUpdated.toLocaleString()} updated ` +
						`(${stats.contentUpdated.toLocaleString()} content, ${stats.priorityUpdated.toLocaleString()} priority, ${stats.metadataUpdated.toLocaleString()} metadata), ` +
						`=${stats.nodesUnchanged.toLocaleString()} unchanged, ` +
						`-${stats.nodesDeleted.toLocaleString()} deleted`,
				);
				this.log(
					`  (${stats.nodesAdded} + ${stats.nodesUpdated} + ${stats.nodesUnchanged} + ${stats.nodesDeleted} = ${stats.totalNodes.toLocaleString()} nodes in ${importElapsedSeconds}s)`,
				);
			}

			const recordBackupInfo = parseBackupFilename(filePath);
			if (recordBackupInfo) {
				await this.recordBackupImport(db, recordBackupInfo);
			}
		} catch (error) {
			if (error instanceof SyntaxError) {
				this.error(`Invalid JSON in backup file: ${error.message}`);
			}
			this.error(`Failed to import backup: ${String(error)}`);
		}
	}

	private async checkIfAlreadyImported(db: ReturnType<typeof createDatabase>, filename: string): Promise<boolean> {
		const existingImport = db
			.select()
			.from(backupImports)
			.where(and(eq(backupImports.filename, filename), eq(backupImports.systemTo, FAR_FUTURE_DATE)))
			.get();
		logger.logSqlResult('import-backup.existingImport', existingImport);

		return existingImport !== undefined;
	}

	private async validateBackupOrder(
		db: ReturnType<typeof createDatabase>,
		backupInfo: {filename: string; backupDate: Date},
		skipConfirmation: boolean,
	): Promise<void> {
		const mostRecentImport = db
			.select()
			.from(backupImports)
			.where(eq(backupImports.systemTo, FAR_FUTURE_DATE))
			.orderBy(desc(backupImports.backupDate))
			.limit(1)
			.get();
		logger.logSqlResult('import-backup.mostRecentImport', mostRecentImport);

		if (!mostRecentImport) {
			return;
		}

		const lastImportDate = new Date(mostRecentImport.backupDate);
		const daysDifference = getDateDifference(lastImportDate, backupInfo.backupDate);

		if (daysDifference < 0) {
			this.error(
				`Cannot import older backup. Last import was ${formatDate(lastImportDate)}, trying to import ${formatDate(backupInfo.backupDate)}`,
			);
		}

		if (daysDifference > 1) {
			const skippedDays = daysDifference - 1;
			const message = `Warning: Skipping ${skippedDays} day${skippedDays > 1 ? 's' : ''} of backups (last: ${formatDate(lastImportDate)}, current: ${formatDate(backupInfo.backupDate)}).`;

			if (skipConfirmation) {
				this.warn(message);
				return;
			}

			const rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout,
			});

			const answer = await rl.question(`${message} Continue? (y/n) `);
			rl.close();

			if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
				this.error('Import cancelled by user');
			}
		}
	}

	private async recordBackupImport(
		db: ReturnType<typeof createDatabase>,
		backupInfo: {filename: string; backupDate: Date},
	): Promise<void> {
		const now = new Date().toISOString();
		db.insert(backupImports)
			.values({
				filename: backupInfo.filename,
				backupDate: formatDate(backupInfo.backupDate),
				systemFrom: now,
				systemTo: FAR_FUTURE_DATE,
			})
			.run();
	}

	private findLatestBackupFile(): string {
		const backupsDirectory = resolveBackupsDirectory();

		if (!fs.existsSync(backupsDirectory)) {
			this.error('No backups directory found. Download a backup first with: workflowy dropbox:download-backup');
		}

		const allBackupFiles: Array<{path: string; date: Date}> = [];

		for (const subdir of ['Data', 'History', '.']) {
			const searchDir = subdir === '.' ? backupsDirectory : path.join(backupsDirectory, subdir);

			if (!fs.existsSync(searchDir)) {
				continue;
			}

			const files = fs.readdirSync(searchDir);

			for (const file of files) {
				const filePath = path.join(searchDir, file);
				const fileInfo = parseBackupFilename(filePath);

				if (fileInfo) {
					allBackupFiles.push({path: filePath, date: fileInfo.backupDate});
				}
			}
		}

		if (allBackupFiles.length === 0) {
			this.error('No backup files found in backups/ directory');
		}

		allBackupFiles.sort((a, b) => b.date.getTime() - a.date.getTime());

		return allBackupFiles[0].path;
	}
}
