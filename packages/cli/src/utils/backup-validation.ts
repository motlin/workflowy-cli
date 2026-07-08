import path from 'node:path';

export type BackupFileInfo = {
	filename: string;
	backupDate: Date;
	source: 'Data';
	compressed: boolean;
};

export function parseBackupFilename(filePath: string): BackupFileInfo | null {
	const filename = path.basename(filePath);
	const dirname = path.basename(path.dirname(filePath));
	const compressed = filename.endsWith('.zst');

	const dataPattern = /\(.*?\)\.(\d{4}-\d{2}-\d{2})\.workflowy\.backup(?:\.zst)?$/;
	const legacyPattern = /^workflowy-backup-(\d{4}-\d{2}-\d{2})\.json(?:\.zst)?$/;

	let match = filename.match(dataPattern);
	if (match && dirname === 'Data') {
		const backupDate = new Date(match[1]);
		if (Number.isNaN(backupDate.getTime())) {
			return null;
		}
		return {filename, backupDate, source: 'Data', compressed};
	}

	match = filename.match(legacyPattern);
	if (match) {
		const backupDate = new Date(match[1]);
		if (Number.isNaN(backupDate.getTime())) {
			return null;
		}
		return {filename, backupDate, source: 'Data', compressed};
	}

	return null;
}

export function getDateDifference(date1: Date, date2: Date): number {
	const msPerDay = 24 * 60 * 60 * 1000;
	const utc1 = Date.UTC(date1.getFullYear(), date1.getMonth(), date1.getDate());
	const utc2 = Date.UTC(date2.getFullYear(), date2.getMonth(), date2.getDate());
	return Math.floor((utc2 - utc1) / msPerDay);
}

export function formatDate(date: Date): string {
	return date.toISOString().split('T')[0];
}
