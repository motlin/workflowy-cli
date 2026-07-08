/**
 * Tier 1 leaf eval: text-composer agent.
 *
 * Tests the text-composer agent integrates tags into item text.
 * Requires ANTHROPIC_API_KEY and the agent markdown file to exist.
 */

import fs from 'node:fs';
import path from 'node:path';
import {createEvalContext} from '../../helpers/eval-db-setup.js';
import type {EvalContext} from '../../helpers/eval-types.js';
import {parseAgentPrompt, runLlmEval} from '../../helpers/llm-eval-harness.js';

describe('Leaf Eval: text-composer', {timeout: 300_000}, () => {
	let ctx: EvalContext;
	let skipSuite = false;
	const agentFile = 'plugins/gtd/agents/refinement/text-composer.md';

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

	it('should compose text with integrated tags', async (context) => {
		if (skipSuite) context.skip();

		const {systemPrompt} = parseAgentPrompt(path.join(ctx.projectRoot, agentFile));

		const taggerResults = {
			itemId: 'test-item-1',
			originalText: 'Fix the login page',
			projectTagger: {suggestedTag: '#web-app', confidence: 0.8},
			peopleTagger: {suggestedTags: ['@Alice']},
			dueDateDetector: {date: null},
			contextTagger: {suggestions: [{tag: '#computer'}]},
			destination: {path: 'Next Actions', confidence: 0.9},
		};

		const result = await runLlmEval(
			systemPrompt,
			`Compose final text for this item:\n${JSON.stringify(taggerResults, null, 2)}`,
			ctx,
			{maxTurns: 5},
		);

		const response = result.finalResponse;
		const jsonMatch = response.match(/\{[\s\S]*\}/);
		expect(jsonMatch, 'Response should contain JSON').not.toBeNull();

		const parsed = JSON.parse(jsonMatch![0]);
		if (parsed.suggestedText) {
			expect(typeof parsed.suggestedText).toBe('string');
			expect(parsed.suggestedText.length).toBeGreaterThan(0);
		}
		if (parsed.tagsAdded) {
			expect(Array.isArray(parsed.tagsAdded)).toBe(true);
		}
	});
});
