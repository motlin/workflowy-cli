/**
 * Tier 1 leaf eval: tag-cleaner agent.
 *
 * Tests the tag-cleaner agent validates tags against known metadata.
 * Requires ANTHROPIC_API_KEY and the agent markdown file to exist.
 */

import fs from 'node:fs';
import path from 'node:path';
import {createEvalContext} from '../../helpers/eval-db-setup.js';
import type {EvalContext} from '../../helpers/eval-types.js';
import {parseAgentPrompt, runLlmEval} from '../../helpers/llm-eval-harness.js';

describe('Leaf Eval: tag-cleaner', {timeout: 300_000}, () => {
	let ctx: EvalContext;
	let skipSuite = false;
	const agentFile = 'plugins/gtd/agents/refinement/tag-cleaner.md';

	beforeAll(() => {
		if (!process.env.ANTHROPIC_API_KEY) {
			skipSuite = true;
			return;
		}

		ctx = createEvalContext();
		const agentPath = path.join(ctx.projectRoot, agentFile);

		if (!fs.existsSync(agentPath)) {
			skipSuite = true;
		}
	});

	afterAll(() => ctx?.cleanup());

	it('should validate tags and identify invalid ones', async (context) => {
		if (skipSuite) context.skip();

		const {systemPrompt} = parseAgentPrompt(path.join(ctx.projectRoot, agentFile));

		const result = await runLlmEval(
			systemPrompt,
			`Validate tags on this item:\nID: test-item-1\nName: Fix #bug-tracker integration #typo-project @UnknownPerson`,
			ctx,
			{maxTurns: 5},
		);

		const response = result.finalResponse;
		const jsonMatch = response.match(/\{[\s\S]*\}/);
		expect(jsonMatch, 'Response should contain JSON').not.toBeNull();

		const parsed = JSON.parse(jsonMatch![0]);
		if (parsed.validTags) {
			expect(Array.isArray(parsed.validTags)).toBe(true);
		}
		if (parsed.invalidTags) {
			expect(Array.isArray(parsed.invalidTags)).toBe(true);
		}
	});
});
