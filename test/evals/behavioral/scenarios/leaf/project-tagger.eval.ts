/**
 * Tier 1 leaf eval: project-tagger agent.
 *
 * Tests the project-tagger agent produces valid JSON with project tag suggestions.
 * Requires ANTHROPIC_API_KEY and the agent markdown file to exist.
 */

import fs from 'node:fs';
import path from 'node:path';
import {createEvalContext, runInEvalContext} from '../../helpers/eval-db-setup.js';
import type {EvalContext} from '../../helpers/eval-types.js';
import {parseAgentPrompt, runLlmEval} from '../../helpers/llm-eval-harness.js';

describe('Leaf Eval: project-tagger', {timeout: 300_000}, () => {
	let ctx: EvalContext;
	let itemId: string;
	let itemName: string;
	let skipSuite = false;
	const agentFile = 'plugins/gtd/agents/refinement/project-tagger.md';

	beforeAll(async () => {
		if (!process.env.ANTHROPIC_API_KEY) {
			skipSuite = true;
			return;
		}

		ctx = createEvalContext();
		const agentPath = path.join(ctx.projectRoot, agentFile);

		if (!fs.existsSync(agentPath)) {
			skipSuite = true;
			return;
		}

		const result = await runInEvalContext(
			ctx,
			`./bin/run.js node get --path "Metadata,📥 Inboxes" --depth 1 --json --fields id --fields children --fields linkTargets 2>/dev/null`,
		);

		if (result.exitCode !== 0) {
			skipSuite = true;
			return;
		}

		try {
			const inboxData = JSON.parse(result.stdout);
			const firstInboxId = inboxData.children?.[0]?.linkTargets?.[0]?.id;
			if (!firstInboxId) {
				skipSuite = true;
				return;
			}

			const itemResult = await runInEvalContext(
				ctx,
				`./bin/run.js node get --id "${firstInboxId}" --depth 1 --json --fields id --fields name --fields children 2>/dev/null`,
			);

			if (itemResult.exitCode !== 0) {
				skipSuite = true;
				return;
			}

			const inboxNode = JSON.parse(itemResult.stdout);
			const firstItem = inboxNode.children?.[0];
			itemId = firstItem?.id;
			itemName = firstItem?.name ?? 'Unknown item';

			if (!itemId) {
				skipSuite = true;
			}
		} catch {
			skipSuite = true;
		}
	});

	afterAll(() => ctx?.cleanup());

	it('should return valid JSON with project tag suggestions', async (context) => {
		if (skipSuite) context.skip();

		const {systemPrompt} = parseAgentPrompt(path.join(ctx.projectRoot, agentFile));

		const result = await runLlmEval(
			systemPrompt,
			`Analyze this item for project tags:\nID: ${itemId}\nName: ${itemName}`,
			ctx,
			{maxTurns: 8},
		);

		const response = result.finalResponse;
		const jsonMatch = response.match(/\{[\s\S]*\}/);
		expect(jsonMatch, 'Response should contain JSON').not.toBeNull();

		const parsed = JSON.parse(jsonMatch![0]);
		if (parsed.suggestedProjects) {
			expect(Array.isArray(parsed.suggestedProjects)).toBe(true);
			for (const proj of parsed.suggestedProjects) {
				expect(proj).toHaveProperty('tag');
				expect(typeof proj.tag).toBe('string');
			}
		}
	});
});
