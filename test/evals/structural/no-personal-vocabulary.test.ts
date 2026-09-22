import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {PROJECT_ROOT, trackedFiles} from './helpers/scan-roots.js';

/**
 * Which holidays and observances someone keeps is personal, so the emoji for
 * them live in the gitignored `.llm/gtd/journal-vocabulary.md`, never in the
 * reusable `plugins/` or `.claude/` files. Naming a specific holiday in a
 * plugin rule reveals the author's religion or culture.
 */

const HOLIDAY_NAMES =
	/\b(christmas|easter|good friday|lent|yom kippur|rosh hashanah|passover|pesach|hanukkah|chanukah|shabbat|sukkot|purim|ramadan|eid|diwali|holi|vesak|lunar new year)\b/i;
const SCAN_ROOTS = ['plugins', '.claude'];

describe('Structural Eval: No Personal Vocabulary', () => {
	it('no tracked file under plugins/ or .claude/ names a specific holiday', () => {
		const violations: string[] = [];

		for (const root of SCAN_ROOTS) {
			for (const relativePath of trackedFiles(root)) {
				const content = readFileSync(join(PROJECT_ROOT, relativePath), 'utf8');
				content.split('\n').forEach((line, index) => {
					const match = HOLIDAY_NAMES.exec(line);
					if (match) {
						violations.push(`${relativePath}:${index + 1}: ${match[0]}`);
					}
				});
			}
		}

		expect(violations).toStrictEqual([]);
	});

	it('refine-journal-prep reads holiday emoji from the private journal vocabulary', () => {
		const prep = readFileSync(join(PROJECT_ROOT, 'plugins/gtd/commands/refine-journal-prep.md'), 'utf8');

		expect(prep).toMatch(/holiday[^\n]*journal-vocabulary\.md|journal-vocabulary\.md[^\n]*holiday/i);
	});
});
