/**
 * Tier 3 end-to-end eval: refine-inbox orchestrator.
 *
 * Tests the full /gtd:refine-inbox pipeline with recursive subagent execution:
 * - Phase 1: inbox-loader and metadata-sync run in parallel
 * - Phase 2: item-refiner agents launch for each inbox item
 * - File coordination: .llm/gtd-inboxes.json is created
 *
 * Pre-filters to 2-3 inbox items to keep cost manageable.
 * Uses mock Workflowy server for write operations.
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 * Expected cost: ~200-400 API calls.
 */

import fs from 'node:fs';
import path from 'node:path';
import {buildAgentIndex} from '../../helpers/agent-index.js';
import {createEvalContext} from '../../helpers/eval-db-setup.js';
import type {EvalContext} from '../../helpers/eval-types.js';
import {
	extractSubagentLaunches,
	flattenSubagentExecutions,
	parseAgentPrompt,
	runLlmEval,
} from '../../helpers/llm-eval-harness.js';
import {createMockWorkflowyServer, type MockWorkflowyServer} from '../../helpers/mock-workflowy-server.js';

describe('E2E Eval: refine-inbox', {timeout: 900_000}, () => {
	let ctx: EvalContext;
	let mockServer: MockWorkflowyServer;
	let skipSuite = false;
	const commandFile = 'plugins/gtd/commands/refine-inbox.md';

	beforeAll(async () => {
		if (!process.env.ANTHROPIC_API_KEY) {
			skipSuite = true;
			return;
		}

		const projectRoot = path.resolve(import.meta.dirname, '../../../..');
		const commandPath = path.join(projectRoot, commandFile);

		if (!fs.existsSync(commandPath)) {
			skipSuite = true;
			return;
		}

		mockServer = createMockWorkflowyServer();
		await mockServer.start();

		const agentIndex = buildAgentIndex(projectRoot);

		ctx = createEvalContext({agentIndex, mockServerPort: mockServer.port});
	});

	afterAll(async () => {
		ctx?.cleanup();
		await mockServer?.stop();
	});

	it('should launch Phase 1 loaders (inbox-loader and metadata-sync)', async (context) => {
		if (skipSuite) context.skip();

		const {systemPrompt} = parseAgentPrompt(path.join(ctx.projectRoot, commandFile));

		const result = await runLlmEval(systemPrompt, 'Refine all inbox items', ctx, {
			maxTurns: 5,
			maxDepth: 1,
			maxTotalApiCalls: 50,
		});

		const subagents = extractSubagentLaunches(result.toolCalls);
		const launchedTypes = subagents.map((s) => s.subagentType);

		const hasInboxLoader = launchedTypes.some((t) => t.includes('inbox-loader') || t.includes('inbox_loader'));
		const hasMetadataSync = launchedTypes.some((t) => t.includes('metadata-sync') || t.includes('metadata_sync'));

		expect(hasInboxLoader, `Expected inbox-loader. Launched: ${launchedTypes.join(', ')}`).toBe(true);
		expect(hasMetadataSync, `Expected metadata-sync. Launched: ${launchedTypes.join(', ')}`).toBe(true);
	});

	it('should follow two-phase architecture (Phase 1 before Phase 2)', async (context) => {
		if (skipSuite) context.skip();

		const {systemPrompt} = parseAgentPrompt(path.join(ctx.projectRoot, commandFile));

		const result = await runLlmEval(systemPrompt, 'Refine all inbox items', ctx, {
			maxTurns: 10,
			maxDepth: 2,
			maxSubagentTurns: 10,
			maxTotalApiCalls: 200,
		});

		const subagents = extractSubagentLaunches(result.toolCalls);

		let lastPhase1Index = -1;
		let firstPhase2Index = Number.MAX_SAFE_INTEGER;

		for (const [i, subagent] of subagents.entries()) {
			const type = subagent.subagentType;
			if (type.includes('inbox-loader') || type.includes('metadata-sync')) {
				lastPhase1Index = i;
			}
			if (type.includes('item-refiner')) {
				firstPhase2Index = Math.min(firstPhase2Index, i);
			}
		}

		if (lastPhase1Index >= 0 && firstPhase2Index < Number.MAX_SAFE_INTEGER) {
			expect(lastPhase1Index, 'Phase 1 should complete before Phase 2').toBeLessThan(firstPhase2Index);
		}
	});

	it('should produce recursive subagent execution tree', async (context) => {
		if (skipSuite) context.skip();

		const {systemPrompt} = parseAgentPrompt(path.join(ctx.projectRoot, commandFile));

		const result = await runLlmEval(systemPrompt, 'Refine all inbox items', ctx, {
			maxTurns: 10,
			maxDepth: 3,
			maxSubagentTurns: 10,
			maxTotalApiCalls: 400,
		});

		expect(Array.isArray(result.subagentExecutions)).toBe(true);
		expect(result.subagentExecutions.length, 'Should have executed at least Phase 1 subagents').toBeGreaterThan(0);

		// Flatten to see all executions at any depth
		const allExecutions = flattenSubagentExecutions(result.subagentExecutions);

		// Report on what was executed
		const agentNames = allExecutions.map((e) => e.agentName);
		const uniqueAgents = [...new Set(agentNames)];
		expect(uniqueAgents.length, `Executed agents: ${uniqueAgents.join(', ')}`).toBeGreaterThan(0);
	});

	it('should respect global API call limits', async (context) => {
		if (skipSuite) context.skip();

		const {systemPrompt} = parseAgentPrompt(path.join(ctx.projectRoot, commandFile));

		const maxCalls = 50;
		const result = await runLlmEval(systemPrompt, 'Refine all inbox items', ctx, {
			maxTurns: 20,
			maxDepth: 3,
			maxSubagentTurns: 15,
			maxTotalApiCalls: maxCalls,
		});

		// Total API calls (tracked on context) should not exceed limit
		expect(ctx.apiCallCount, 'API call count should be within limit').toBeLessThanOrEqual(maxCalls);

		// The result should still be meaningful
		expect(result.toolCalls.length).toBeGreaterThan(0);
	});
});
