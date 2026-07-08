/**
 * Tier 1 leaf eval: due-date-detector agent.
 *
 * Tests the due-date-detector agent parses dates and urgency.
 * Requires ANTHROPIC_API_KEY and the agent markdown file to exist.
 */

import fs from 'node:fs';
import path from 'node:path';
import {createEvalContext} from '../../helpers/eval-db-setup.js';
import type {EvalContext} from '../../helpers/eval-types.js';
import {parseAgentPrompt, runLlmEval} from '../../helpers/llm-eval-harness.js';

describe('Leaf Eval: due-date-detector', {timeout: 300_000}, () => {
	let ctx: EvalContext;
	let skipSuite = false;
	const agentFile = 'plugins/gtd/agents/refinement/due-date-detector.md';

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

	it('should detect date from item text with explicit deadline', async (context) => {
		if (skipSuite) context.skip();

		const {systemPrompt} = parseAgentPrompt(path.join(ctx.projectRoot, agentFile));

		const result = await runLlmEval(
			systemPrompt,
			`Analyze this item for due dates:\nID: test-item-1\nName: Submit tax return by April 15th`,
			ctx,
			{maxTurns: 5},
		);

		const response = result.finalResponse;
		const jsonMatch = response.match(/\{[\s\S]*\}/);
		expect(jsonMatch, 'Response should contain JSON').not.toBeNull();

		const parsed = JSON.parse(jsonMatch![0]);
		expect(parsed).toHaveProperty('date');
		expect(typeof parsed.date).toBe('string');
		expect(parsed.date).toMatch(/april|04-15|4\/15/i);
	});

	it('should detect urgency keywords', async (context) => {
		if (skipSuite) context.skip();

		const {systemPrompt} = parseAgentPrompt(path.join(ctx.projectRoot, agentFile));

		const result = await runLlmEval(
			systemPrompt,
			`Analyze this item for due dates:\nID: test-item-2\nName: URGENT: Fix production server crash ASAP`,
			ctx,
			{maxTurns: 5},
		);

		const response = result.finalResponse;
		const jsonMatch = response.match(/\{[\s\S]*\}/);
		expect(jsonMatch, 'Response should contain JSON').not.toBeNull();

		const parsed = JSON.parse(jsonMatch![0]);
		if (parsed.isAsap !== undefined) {
			expect(parsed.isAsap).toBe(true);
		}
		if (parsed.urgencyLevel !== undefined) {
			expect(typeof parsed.urgencyLevel).toBe('string');
		}
	});
});
