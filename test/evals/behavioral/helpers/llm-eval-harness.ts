/**
 * LLM eval harness for behavioral evals.
 *
 * Invokes Claude API with agent prompts, captures tool calls,
 * and returns the full conversation for assertion.
 *
 * Supports recursive subagent execution: when the model calls the `task` tool,
 * the harness resolves the subagent_type to an agent markdown file, parses
 * the system prompt, and recursively calls runLlmEval() with the subagent's prompt.
 */

import Anthropic from '@anthropic-ai/sdk';
import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {resolveAgent} from './agent-index.js';
import type {CapturedToolCall, EvalContext, LlmEvalResult, SubagentExecution} from './eval-types.js';

// Re-export types from eval-types for backward compatibility
export type {CapturedToolCall, LlmEvalResult} from './eval-types.js';

/** Options for running an LLM eval. */
export interface LlmEvalOptions {
	/** Maximum conversation turns before stopping (default: 10) */
	maxTurns?: number;
	/** Model to use (default: claude-sonnet-4-20250514) */
	model?: string;
	/** Maximum tokens per response (default: 4096) */
	maxTokens?: number;
	/** Current recursion depth (default: 0) */
	depth?: number;
	/** Maximum recursion depth for subagent calls (default: 3) */
	maxDepth?: number;
	/** Maximum turns per subagent conversation (default: 15) */
	maxSubagentTurns?: number;
	/** Global ceiling on total API calls across all recursive conversations (default: 200) */
	maxTotalApiCalls?: number;
}

/** Tool definitions available to the agent during eval. */
const EVAL_TOOLS: Anthropic.Tool[] = [
	{
		name: 'bash',
		description: 'Execute a bash command. Returns stdout, stderr, and exit code.',
		input_schema: {
			type: 'object' as const,
			properties: {
				command: {
					type: 'string',
					description: 'The bash command to execute',
				},
			},
			required: ['command'],
		},
	},
	{
		name: 'task',
		description: 'Launch a subagent to perform a task.',
		input_schema: {
			type: 'object' as const,
			properties: {
				subagent_type: {
					type: 'string',
					description: 'The type of subagent to launch',
				},
				prompt: {
					type: 'string',
					description: 'The prompt to send to the subagent',
				},
			},
			required: ['subagent_type', 'prompt'],
		},
	},
	{
		name: 'read_file',
		description: 'Read contents of a file.',
		input_schema: {
			type: 'object' as const,
			properties: {
				path: {
					type: 'string',
					description: 'Path to the file to read',
				},
			},
			required: ['path'],
		},
	},
	{
		name: 'write_file',
		description: 'Write contents to a file. Creates directories as needed.',
		input_schema: {
			type: 'object' as const,
			properties: {
				path: {
					type: 'string',
					description: 'Path to the file to write',
				},
				content: {
					type: 'string',
					description: 'Content to write to the file',
				},
			},
			required: ['path', 'content'],
		},
	},
	{
		name: 'grep',
		description: 'Search for a pattern in files. Returns matching lines with file paths and line numbers.',
		input_schema: {
			type: 'object' as const,
			properties: {
				pattern: {
					type: 'string',
					description: 'Regular expression pattern to search for',
				},
				path: {
					type: 'string',
					description: 'File or directory to search in',
				},
				include: {
					type: 'string',
					description: 'File glob pattern to include (e.g., "*.ts")',
				},
			},
			required: ['pattern'],
		},
	},
	{
		name: 'glob',
		description: 'Find files matching a glob pattern. Returns matching file paths.',
		input_schema: {
			type: 'object' as const,
			properties: {
				pattern: {
					type: 'string',
					description: 'Glob pattern to match (e.g., "**/*.ts")',
				},
				path: {
					type: 'string',
					description: 'Directory to search in',
				},
			},
			required: ['pattern'],
		},
	},
];

/**
 * Execute a tool call in the eval environment.
 *
 * For bash commands, actually runs them against the eval database.
 * For task/subagent calls with an agent index, recursively invokes runLlmEval().
 * For file reads/writes, operates on the eval context's directories.
 * For grep/glob, runs against the project root.
 */
async function executeToolCall(
	toolCall: {name: string; input: Record<string, unknown>},
	ctx: EvalContext,
	options: LlmEvalOptions,
	subagentExecutions: SubagentExecution[],
): Promise<string> {
	switch (toolCall.name) {
		case 'bash': {
			const command = toolCall.input.command as string;
			const env: Record<string, string | undefined> = {
				...process.env,
				...ctx.env,
			};
			if (!ctx.mockServerPort) {
				delete env.WORKFLOWY_API_KEY;
			}

			try {
				const stdout = execSync(command, {
					cwd: ctx.projectRoot,
					encoding: 'utf8',
					env,
					maxBuffer: 10 * 1024 * 1024,
					stdio: ['pipe', 'pipe', 'pipe'],
					timeout: 30_000,
				});
				return stdout;
			} catch (error: unknown) {
				const execError = error as {stdout?: string; stderr?: string; status?: number};
				return `Exit code: ${execError.status ?? 1}\nstdout: ${execError.stdout ?? ''}\nstderr: ${execError.stderr ?? ''}`;
			}
		}

		case 'task': {
			const subagentType = toolCall.input.subagent_type as string;
			const prompt = toolCall.input.prompt as string;
			const depth = options.depth ?? 0;
			const maxDepth = options.maxDepth ?? 3;

			// Check recursion depth
			if (depth >= maxDepth) {
				return JSON.stringify({
					status: 'error',
					error: `Maximum subagent depth (${maxDepth}) exceeded`,
				});
			}

			// Check global API call limit
			const maxTotalApiCalls = options.maxTotalApiCalls ?? 200;
			if ((ctx.apiCallCount ?? 0) >= maxTotalApiCalls) {
				return JSON.stringify({
					status: 'error',
					error: `Maximum total API calls (${maxTotalApiCalls}) exceeded`,
				});
			}

			// Try to resolve agent from index
			if (!ctx.agentIndex) {
				return JSON.stringify({
					status: 'completed',
					subagent: subagentType,
					prompt,
					result: `Simulated ${subagentType} completed successfully`,
				});
			}

			const agentEntry = resolveAgent(subagentType, ctx.agentIndex);
			if (!agentEntry) {
				return JSON.stringify({
					status: 'completed',
					subagent: subagentType,
					prompt,
					result: `Simulated ${subagentType} completed successfully (agent not found in index)`,
				});
			}

			// Recursively execute the subagent
			const subagentResult = await runLlmEval(agentEntry.systemPrompt, prompt, ctx, {
				...options,
				depth: depth + 1,
				maxTurns: options.maxSubagentTurns ?? 15,
			});

			subagentExecutions.push({
				agentName: subagentType,
				prompt,
				result: subagentResult,
			});

			return subagentResult.finalResponse || 'Subagent completed with no text response.';
		}

		case 'read_file': {
			const filePath = toolCall.input.path as string;
			try {
				return fs.readFileSync(filePath, 'utf8');
			} catch {
				return `Error: File not found: ${filePath}`;
			}
		}

		case 'write_file': {
			const filePath = toolCall.input.path as string;
			const content = toolCall.input.content as string;
			try {
				fs.mkdirSync(path.dirname(filePath), {recursive: true});
				fs.writeFileSync(filePath, content, 'utf8');
				return `Successfully wrote ${content.length} bytes to ${filePath}`;
			} catch (error) {
				return `Error writing file: ${String(error)}`;
			}
		}

		case 'grep': {
			const pattern = toolCall.input.pattern as string;
			const searchPath = (toolCall.input.path as string) ?? ctx.projectRoot;
			const include = toolCall.input.include as string | undefined;

			try {
				let cmd = `grep -rn "${pattern.replaceAll('"', String.raw`\"`)}" "${searchPath}"`;
				if (include) {
					cmd = `grep -rn --include="${include}" "${pattern.replaceAll('"', String.raw`\"`)}" "${searchPath}"`;
				}
				const stdout = execSync(cmd, {
					cwd: ctx.projectRoot,
					encoding: 'utf8',
					maxBuffer: 5 * 1024 * 1024,
					stdio: ['pipe', 'pipe', 'pipe'],
					timeout: 10_000,
				});
				// Limit output to avoid token bloat
				const lines = stdout.split('\n');
				if (lines.length > 50) {
					return lines.slice(0, 50).join('\n') + `\n... (${lines.length - 50} more lines)`;
				}
				return stdout;
			} catch {
				return 'No matches found.';
			}
		}

		case 'glob': {
			const pattern = toolCall.input.pattern as string;
			const searchPath = (toolCall.input.path as string) ?? ctx.projectRoot;

			try {
				// Use find for glob-like behavior
				const cmd = `find "${searchPath}" -path "${pattern}" -type f 2>/dev/null | head -50`;
				const stdout = execSync(cmd, {
					cwd: ctx.projectRoot,
					encoding: 'utf8',
					maxBuffer: 5 * 1024 * 1024,
					stdio: ['pipe', 'pipe', 'pipe'],
					timeout: 10_000,
				});
				return stdout || 'No matching files found.';
			} catch {
				return 'No matching files found.';
			}
		}

		default: {
			return `Unknown tool: ${toolCall.name}`;
		}
	}
}

/**
 * Run an LLM eval scenario by sending a prompt to Claude and capturing
 * all tool calls and responses.
 *
 * When the agent calls the `task` tool and an agent index is available on the
 * context, the harness recursively invokes itself with the resolved subagent's
 * system prompt. This allows testing the full subagent tree.
 *
 * @param systemPrompt - The agent's system prompt (from markdown file)
 * @param userMessage - The user message to send (e.g., "Refine item <ID>")
 * @param ctx - The eval context with database and environment
 * @param options - Additional options for controlling execution
 */
export async function runLlmEval(
	systemPrompt: string,
	userMessage: string,
	ctx: EvalContext,
	options: LlmEvalOptions = {},
): Promise<LlmEvalResult> {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		throw new Error(
			'ANTHROPIC_API_KEY is required for LLM-powered evals. Set it in your environment or skip these tests.',
		);
	}

	const client = new Anthropic({apiKey});
	const maxTurns = options.maxTurns ?? 10;
	const model = options.model ?? 'claude-sonnet-4-20250514';
	const maxTokens = options.maxTokens ?? 4096;
	const maxTotalApiCalls = options.maxTotalApiCalls ?? 200;

	const toolCalls: CapturedToolCall[] = [];
	const subagentExecutions: SubagentExecution[] = [];
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let finalResponse = '';
	let stopReason = '';

	const messages: Anthropic.MessageParam[] = [{role: 'user', content: userMessage}];

	for (let turn = 0; turn < maxTurns; turn++) {
		// Check global API call limit
		if ((ctx.apiCallCount ?? 0) >= maxTotalApiCalls) {
			stopReason = 'max_api_calls';
			break;
		}

		ctx.apiCallCount = (ctx.apiCallCount ?? 0) + 1;

		const response = await client.messages.create({
			model,
			max_tokens: maxTokens,
			system: systemPrompt,
			tools: EVAL_TOOLS,
			messages,
		});

		totalInputTokens += response.usage.input_tokens;
		totalOutputTokens += response.usage.output_tokens;
		stopReason = response.stop_reason ?? 'unknown';

		// Collect text blocks and tool use blocks
		const textBlocks: string[] = [];
		const toolUseBlocks: Array<{id: string; name: string; input: Record<string, unknown>}> = [];

		for (const block of response.content) {
			if (block.type === 'text') {
				textBlocks.push(block.text);
			} else if (block.type === 'tool_use') {
				toolUseBlocks.push({
					id: block.id,
					name: block.name,
					input: block.input as Record<string, unknown>,
				});
			}
		}

		finalResponse = textBlocks.join('\n');

		// If no tool calls, conversation is done
		if (toolUseBlocks.length === 0) {
			break;
		}

		// Add assistant message to conversation
		messages.push({role: 'assistant', content: response.content});

		// Process tool calls - handle parallel task calls with Promise.all
		const taskCalls = toolUseBlocks.filter((tb) => tb.name === 'task');
		const nonTaskCalls = toolUseBlocks.filter((tb) => tb.name !== 'task');

		const toolResults: Anthropic.ToolResultBlockParam[] = [];

		// Execute non-task calls sequentially (bash, read_file, etc.)
		for (const toolUse of nonTaskCalls) {
			const result = await executeToolCall(
				{name: toolUse.name, input: toolUse.input},
				ctx,
				options,
				subagentExecutions,
			);

			toolCalls.push({
				name: toolUse.name,
				input: toolUse.input,
				result,
			});

			toolResults.push({
				type: 'tool_result',
				tool_use_id: toolUse.id,
				content: result,
			});
		}

		// Execute task calls in parallel
		if (taskCalls.length > 0) {
			const taskResults = await Promise.all(
				taskCalls.map(async (toolUse) => {
					const result = await executeToolCall(
						{name: toolUse.name, input: toolUse.input},
						ctx,
						options,
						subagentExecutions,
					);

					toolCalls.push({
						name: toolUse.name,
						input: toolUse.input,
						result,
					});

					return {
						type: 'tool_result' as const,
						tool_use_id: toolUse.id,
						content: result,
					};
				}),
			);
			toolResults.push(...taskResults);
		}

		// Sort tool results to match the order of tool use blocks
		const orderedResults = toolUseBlocks.map((tb) => toolResults.find((tr) => tr.tool_use_id === tb.id)!);

		// Add tool results to conversation
		messages.push({role: 'user', content: orderedResults});
	}

	return {
		toolCalls,
		finalResponse,
		inputTokens: totalInputTokens,
		outputTokens: totalOutputTokens,
		stopReason,
		subagentExecutions,
	};
}

/**
 * Parse an agent markdown file to extract the system prompt.
 * Strips YAML frontmatter and returns the body content.
 */
export function parseAgentPrompt(filePath: string): {
	frontmatter: Record<string, unknown>;
	systemPrompt: string;
} {
	const content = fs.readFileSync(filePath, 'utf8');

	// Split frontmatter from body
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!frontmatterMatch) {
		return {frontmatter: {}, systemPrompt: content};
	}

	// Simple YAML parsing for key: value pairs
	const frontmatter: Record<string, unknown> = {};
	for (const line of frontmatterMatch[1].split('\n')) {
		const match = line.match(/^(\w+):\s*(.*)$/);
		if (match) {
			frontmatter[match[1]] = match[2];
		}
	}

	return {
		frontmatter,
		systemPrompt: frontmatterMatch[2].trim(),
	};
}

/**
 * Extract bash commands from captured tool calls.
 */
export function extractBashCommands(toolCalls: CapturedToolCall[]): string[] {
	return toolCalls.filter((tc) => tc.name === 'bash').map((tc) => tc.input.command as string);
}

/**
 * Extract subagent launches from captured tool calls.
 */
export function extractSubagentLaunches(toolCalls: CapturedToolCall[]): Array<{subagentType: string; prompt: string}> {
	return toolCalls
		.filter((tc) => tc.name === 'task')
		.map((tc) => ({
			subagentType: tc.input.subagent_type as string,
			prompt: tc.input.prompt as string,
		}));
}

/**
 * Flatten the subagent execution tree into a flat list.
 * Useful for assertions that want to check all subagents at any depth.
 */
export function flattenSubagentExecutions(executions: SubagentExecution[]): SubagentExecution[] {
	const result: SubagentExecution[] = [];
	for (const exec of executions) {
		result.push(exec, ...flattenSubagentExecutions(exec.result.subagentExecutions));
	}
	return result;
}
