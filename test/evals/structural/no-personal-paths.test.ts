import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {PROJECT_ROOT} from './helpers/scan-roots.js';

/**
 * `plugins/` and `.claude/` are version-controlled and meant to be reusable, so
 * they must not carry one machine's home directory. A hardcoded `/Users/<name>`
 * both leaks the author's username and breaks the file for anyone else.
 *
 * Only tracked files are scanned. Gitignored personal config (`.claude/
 * settings.local.json`, `.llm/`) is exempt by design -- that is where
 * machine-specific paths are supposed to live.
 */

const HOME_PATH = /\/Users\/[A-Za-z0-9._-]+/;
const SCAN_ROOTS = ['plugins', '.claude'];

function trackedFiles(root: string): string[] {
	const output = execFileSync('git', ['ls-files', '-z', '--', root], {
		cwd: PROJECT_ROOT,
		encoding: 'utf8',
	});
	return output.split('\0').filter(Boolean);
}

describe('Structural Eval: No Personal Paths', () => {
	it('no tracked file under plugins/ or .claude/ hardcodes a home directory', () => {
		const violations: string[] = [];

		for (const root of SCAN_ROOTS) {
			for (const relPath of trackedFiles(root)) {
				const content = readFileSync(join(PROJECT_ROOT, relPath), 'utf8');
				content.split('\n').forEach((line, index) => {
					const match = HOME_PATH.exec(line);
					if (match) {
						violations.push(`${relPath}:${index + 1}: ${match[0]}`);
					}
				});
			}
		}

		expect(violations).toEqual([]);
	});
});
