import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {PROJECT_ROOT} from './helpers/scan-roots.js';

/**
 * `plugins/workflowy/skills/cli-usage.md` bans `2>/dev/null` on CLI commands:
 * a suppressed error turns a failed write into a phantom success, and the
 * calling script or prompt then reports "Deleted" for a node that still
 * exists. This eval enforces that rule mechanically for the mutating
 * `node` subcommands, where the cost of a silent failure is highest.
 *
 * Only tracked files are scanned, matching no-personal-paths.
 */

const MUTATING_INVOCATION = /\.\/bin\/run\.js node (?:create|update|delete|move)\b/;
const DEV_NULL_REDIRECT = /(?:[12&]?>|>&)\s*\/dev\/null/;

function trackedFiles(root: string): string[] {
	const output = execFileSync('git', ['ls-files', '-z', '--', root], {
		cwd: PROJECT_ROOT,
		encoding: 'utf8',
	});
	return output.split('\0').filter(Boolean);
}

describe('Structural Eval: No Suppressed Mutations', () => {
	it('no tracked file under plugins/ redirects a mutating node command to /dev/null', () => {
		const violations: string[] = [];

		for (const relPath of trackedFiles('plugins')) {
			const content = readFileSync(join(PROJECT_ROOT, relPath), 'utf8');
			content.split('\n').forEach((line, index) => {
				if (MUTATING_INVOCATION.test(line) && DEV_NULL_REDIRECT.test(line)) {
					violations.push(`${relPath}:${index + 1}: ${line.trim()}`);
				}
			});
		}

		expect(violations).toStrictEqual([]);
	});
});
