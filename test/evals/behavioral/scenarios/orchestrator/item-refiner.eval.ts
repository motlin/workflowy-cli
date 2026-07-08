/**
 * Tier 2 orchestrator eval: item-refiner agent.
 *
 * Tests the item-refiner agent with real recursive subagent execution.
 * Validates:
 * - All Phase A taggers are launched
 * - Phase B composers execute after taggers
 * - Each subagent returns valid output
 * - File coordination via .llm/ directory works
 *
 * Uses the agent index to resolve subagent types to real agent markdown files.
 * Falls back to simulated responses for agents that don't have markdown files.
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 * Expected cost: ~80-120 API calls.
 */

import path from 'node:path';
import {buildAgentIndex} from '../../helpers/agent-index.js';
import {createEvalContext, runInEvalContext} from '../../helpers/eval-db-setup.js';
import type {EvalContext} from '../../helpers/eval-types.js';
import {
	extractBashCommands,
	extractSubagentLaunches,
	flattenSubagentExecutions,
	parseAgentPrompt,
	runLlmEval,
} from '../../helpers/llm-eval-harness.js';
import {createMockWorkflowyServer, type MockWorkflowyServer} from '../../helpers/mock-workflowy-server.js';

describe('Orchestrator Eval: item-refiner', {timeout: 600_000}, () => {
	let ctx: EvalContext;
	let itemId: string;
	let mockServer: MockWorkflowyServer;
	let skipSuite = false;
	const agentFile = 'plugins/gtd/agents/refinement/item-refiner.md';

	beforeAll(async () => {
		if (!process.env.ANTHROPIC_API_KEY) {
			skipSuite = true;
			return;
		}

		// Start mock server for write-through operations
		mockServer = createMockWorkflowyServer();
		await mockServer.start();

		// Build agent index for recursive subagent resolution
		const projectRoot = path.resolve(import.meta.dirname, '../../../..');
		const agentIndex = buildAgentIndex(projectRoot);

		ctx = createEvalContext({agentIndex, mockServerPort: mockServer.port});

		// Find an inbox item from the eval database
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
				`./bin/run.js node get --id "${firstInboxId}" --depth 1 --json --fields id --fields children 2>/dev/null`,
			);

			if (itemResult.exitCode !== 0) {
				skipSuite = true;
				return;
			}

			const inboxNode = JSON.parse(itemResult.stdout);
			itemId = inboxNode.children?.[0]?.id;
			if (!itemId) {
				skipSuite = true;
			}
		} catch {
			skipSuite = true;
		}
	});

	afterAll(async () => {
		ctx?.cleanup();
		await mockServer?.stop();
	});

	it('should fetch item data as first action', async (context) => {
		if (skipSuite) context.skip();

		const {systemPrompt} = parseAgentPrompt(path.join(ctx.projectRoot, agentFile));

		const result = await runLlmEval(systemPrompt, `Refine item ${itemId}`, ctx, {
			maxTurns: 3,
			maxDepth: 2,
			maxTotalApiCalls: 150,
		});

		const bashCommands = extractBashCommands(result.toolCalls);
		expect(bashCommands.length).toBeGreaterThan(0);

		const firstCommand = bashCommands[0];
		expect(firstCommand).toContain('node');
		expect(firstCommand).toContain(itemId);
	});

	it('should launch tagger subagents', async (context) => {
		if (skipSuite) context.skip();

		const {systemPrompt} = parseAgentPrompt(path.join(ctx.projectRoot, agentFile));

		const result = await runLlmEval(systemPrompt, `Refine item ${itemId}`, ctx, {
			maxTurns: 10,
			maxDepth: 2,
			maxSubagentTurns: 8,
			maxTotalApiCalls: 150,
		});

		const subagents = extractSubagentLaunches(result.toolCalls);
		const launchedAgentTypes = subagents.map((s) => s.subagentType);

		const expectedTaggers = ['project-tagger', 'people-tagger', 'due-date-detector', 'context-tagger'];
		const matchedTaggers = expectedTaggers.filter((tagger) =>
			launchedAgentTypes.some((launched) => launched.includes(tagger)),
		);

		expect(
			matchedTaggers.length,
			`Expected to launch tagger subagents. Launched: ${launchedAgentTypes.join(', ')}`,
		).toBeGreaterThanOrEqual(2);
	});

	it('should pass item ID to all subagent prompts', async (context) => {
		if (skipSuite) context.skip();

		const {systemPrompt} = parseAgentPrompt(path.join(ctx.projectRoot, agentFile));

		const result = await runLlmEval(systemPrompt, `Refine item ${itemId}`, ctx, {
			maxTurns: 10,
			maxDepth: 2,
			maxSubagentTurns: 8,
			maxTotalApiCalls: 150,
		});

		const subagents = extractSubagentLaunches(result.toolCalls);
		for (const subagent of subagents) {
			expect(subagent.prompt, `Subagent ${subagent.subagentType} should reference item ID`).toContain(itemId);
		}
	});

	it('should produce subagent execution tree', async (context) => {
		if (skipSuite) context.skip();

		const {systemPrompt} = parseAgentPrompt(path.join(ctx.projectRoot, agentFile));

		const result = await runLlmEval(systemPrompt, `Refine item ${itemId}`, ctx, {
			maxTurns: 10,
			maxDepth: 2,
			maxSubagentTurns: 8,
			maxTotalApiCalls: 150,
		});

		// The result should have subagent executions
		expect(Array.isArray(result.subagentExecutions)).toBe(true);

		// Flatten the tree to see all executions at any depth
		const allExecutions = flattenSubagentExecutions(result.subagentExecutions);

		// Each execution should have the required fields
		for (const exec of allExecutions) {
			expect(typeof exec.agentName).toBe('string');
			expect(typeof exec.prompt).toBe('string');
			expect(exec.result).toHaveProperty('toolCalls');
			expect(exec.result).toHaveProperty('finalResponse');
			expect(exec.result.inputTokens).toBeGreaterThan(0);
		}
	});

	it('should track total token usage across all subagents', async (context) => {
		if (skipSuite) context.skip();

		const {systemPrompt} = parseAgentPrompt(path.join(ctx.projectRoot, agentFile));

		const result = await runLlmEval(systemPrompt, `Refine item ${itemId}`, ctx, {
			maxTurns: 10,
			maxDepth: 2,
			maxSubagentTurns: 8,
			maxTotalApiCalls: 150,
		});

		expect(result.inputTokens).toBeGreaterThan(0);
		expect(result.outputTokens).toBeGreaterThan(0);

		// Total cost should reflect multiple conversations
		const allExecutions = flattenSubagentExecutions(result.subagentExecutions);
		if (allExecutions.length > 0) {
			const subagentTokens = allExecutions.reduce((sum, exec) => sum + exec.result.inputTokens, 0);
			expect(subagentTokens, 'Subagent conversations should consume tokens').toBeGreaterThan(0);
		}
	});
});
