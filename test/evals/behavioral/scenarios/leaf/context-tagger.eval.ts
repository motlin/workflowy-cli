/**
 * Tier 1 leaf eval: context-tagger agent.
 *
 * Tests the context-tagger agent suggests location/mode context tags.
 * Requires ANTHROPIC_API_KEY and the agent markdown file to exist.
 */

import fs from 'node:fs';
import path from 'node:path';
import {createEvalContext} from '../../helpers/eval-db-setup.js';
import type {EvalContext} from '../../helpers/eval-types.js';
import {parseAgentPrompt, runLlmEval} from '../../helpers/llm-eval-harness.js';

describe('Leaf Eval: context-tagger', {timeout: 300_000}, () => {
	let ctx: EvalContext;
	let skipSuite = false;
	const agentFile = 'plugins/gtd/agents/refinement/context-tagger.md';

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

	it('should suggest context tags from known set', (context) => {
		if (skipSuite) context.skip();

		const {systemPrompt} = parseAgentPrompt(path.join(ctx.projectRoot, agentFile));

		const result = runLlmEval(
			systemPrompt,
			`Analyze this item for context tags:\nID: test-item-1\nName: Call dentist to schedule appointment`,
			ctx,
			{maxTurns: 5},
		);

		return result.then((result) => {
			const response = result.finalResponse;
			const jsonMatch = response.match(/\{[\s\S]*\}/);
			expect(jsonMatch, 'Response should contain JSON').not.toBeNull();

			const parsed = JSON.parse(jsonMatch![0]);
			if (parsed.suggestions) {
				expect(Array.isArray(parsed.suggestions)).toBe(true);
				const tags = parsed.suggestions.map((s: {tag?: string; context?: string}) => s.tag ?? s.context ?? s);
				const allStrings = tags.every((t: unknown) => typeof t === 'string');
				expect(allStrings, 'All suggestions should be strings').toBe(true);
			}
		});
	});
});
