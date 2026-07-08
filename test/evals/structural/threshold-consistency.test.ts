import {parseMarkdownFile} from './helpers/markdown-parser.js';
import {PROJECT_ROOT, collectComponentFiles} from './helpers/scan-roots.js';

interface ThresholdOccurrence {
	value: number;
	context: string;
	file: string;
	line: number;
}

/**
 * Known threshold concepts and the keywords that identify them in context lines.
 * Each concept groups thresholds that should use consistent values.
 */
const THRESHOLD_CONCEPTS: Array<{
	name: string;
	test: (ctx: string) => boolean;
}> = [
	{
		name: 'capture-decision',
		test: (ctx) => /capture/i.test(ctx) && /confidence/i.test(ctx) && />=/.test(ctx),
	},
	{
		name: 'auto-accept',
		test: (ctx) => /auto[- ]?(accept|move)/i.test(ctx) || /high confidence.*>=/.test(ctx),
	},
	{
		name: 'ask-user',
		test: (ctx) =>
			(/ask user/i.test(ctx) || /low confidence/i.test(ctx) || /needs decision/i.test(ctx)) && />/.test(ctx),
	},
	{
		name: 'people-tagger-min',
		test: (ctx) => /people|mention/i.test(ctx) && />=/.test(ctx),
	},
	{
		name: 'project-tagger-min',
		test: (ctx) => /project.*tag/i.test(ctx) && />=/.test(ctx),
	},
	{
		name: 'context-tagger-min',
		test: (ctx) => /context.*tag/i.test(ctx) && />=/.test(ctx),
	},
	{
		name: 'correction-confidence',
		test: (ctx) => /correction/i.test(ctx) && />=/.test(ctx),
	},
	{
		name: 'date-detection-min',
		test: (ctx) => /date|due/i.test(ctx) && /explicit/i.test(ctx) && />=/.test(ctx),
	},
];

/**
 * Classify a threshold occurrence into a concept, if possible.
 */
function classifyThreshold(occurrence: ThresholdOccurrence): string | null {
	for (const concept of THRESHOLD_CONCEPTS) {
		if (concept.test(occurrence.context)) {
			return concept.name;
		}
	}
	return null;
}

describe('Structural Eval: Threshold Consistency', () => {
	let allThresholds: ThresholdOccurrence[];

	beforeAll(() => {
		allThresholds = [];
		const sourceFiles = [
			...collectComponentFiles('commands'),
			...collectComponentFiles('agents'),
			...collectComponentFiles('skills'),
		];

		for (const filePath of sourceFiles) {
			const analysis = parseMarkdownFile(filePath);
			const relativeFile = filePath.replace(PROJECT_ROOT + '/', '');

			for (const ref of analysis.thresholds) {
				allThresholds.push({
					value: ref.value,
					context: ref.context,
					file: relativeFile,
					line: ref.line,
				});
			}
		}
	});

	it('should find thresholds across markdown files', () => {
		expect(allThresholds.length).toBeGreaterThan(0);
	});

	// oxlint-disable-next-line vitest/expect-expect
	it('should report all thresholds grouped by file for review', () => {
		// Group thresholds by file
		const byFile = new Map<string, ThresholdOccurrence[]>();
		for (const t of allThresholds) {
			const existing = byFile.get(t.file) ?? [];
			existing.push(t);
			byFile.set(t.file, existing);
		}

		// This test always passes -- it logs the inventory for human review
		const report: string[] = ['Threshold inventory:'];
		for (const [file, thresholds] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
			report.push(`  ${file}:`);
			for (const t of thresholds) {
				report.push(`    L${t.line}: ${t.value} - ${t.context.slice(0, 80)}`);
			}
		}

		// Log the report as test context (visible on verbose runs)
		console.log(report.join('\n'));
	});

	it('thresholds for the same concept should use consistent values across files', () => {
		// Group thresholds by concept
		const byConcept = new Map<string, ThresholdOccurrence[]>();
		for (const t of allThresholds) {
			const concept = classifyThreshold(t);
			if (concept) {
				const existing = byConcept.get(concept) ?? [];
				existing.push(t);
				byConcept.set(concept, existing);
			}
		}

		const inconsistencies: string[] = [];

		for (const [concept, occurrences] of byConcept) {
			const uniqueValues = [...new Set(occurrences.map((o) => o.value))];
			if (uniqueValues.length > 1) {
				const details = occurrences.map((o) => `    ${o.value} at ${o.file}:${o.line}`).join('\n');
				inconsistencies.push(`  "${concept}" uses values [${uniqueValues.join(', ')}]:\n${details}`);
			}
		}

		expect(inconsistencies).toHaveLength(0);
	});
});
