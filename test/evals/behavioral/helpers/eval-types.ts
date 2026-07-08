/**
 * Type definitions for behavioral eval scenarios.
 *
 * Behavioral evals run skills, scripts, and CLI commands against a local
 * SQLite copy of the Workflowy data and evaluate outcomes.
 */

export interface AgentIndexEntry {
	/** Agent name from frontmatter */
	name: string;
	/** Absolute path to the agent markdown file */
	filePath: string;
	/** Parsed system prompt (body after frontmatter) */
	systemPrompt: string;
	/** Raw frontmatter key-value pairs */
	frontmatter: Record<string, unknown>;
}

export interface AgentIndex {
	/** Map from agent name/alias to index entry */
	entries: Map<string, AgentIndexEntry>;
}

/** Captured tool call from an LLM eval conversation. */
export interface CapturedToolCall {
	name: string;
	input: Record<string, unknown>;
	result: string;
}

/** Result of running an LLM eval scenario. */
export interface LlmEvalResult {
	toolCalls: CapturedToolCall[];
	finalResponse: string;
	inputTokens: number;
	outputTokens: number;
	stopReason: string;
	subagentExecutions: SubagentExecution[];
}

export interface SubagentExecution {
	/** The subagent_type string from the task tool call */
	agentName: string;
	/** The prompt sent to the subagent */
	prompt: string;
	/** The full eval result from the subagent's conversation */
	result: LlmEvalResult;
}

export interface EvalContext {
	/** Path to the temporary copy of workflowy.sqlite */
	dbPath: string;
	/** Path to the temporary .llm/ directory for intermediate files */
	llmDir: string;
	/** Project root directory (for resolving relative paths) */
	projectRoot: string;
	/** Environment variables to set when running commands */
	env: Record<string, string>;
	/** Clean up temp files and restore environment */
	cleanup: () => void;
	/** Pre-built agent index for subagent resolution */
	agentIndex?: AgentIndex;
	/** Global API call counter shared across recursive subagent calls */
	apiCallCount?: number;
	/** Port the mock Workflowy server is listening on */
	mockServerPort?: number;
}

export interface EvalResult {
	/** Standard output from the command */
	stdout: string;
	/** Standard error from the command */
	stderr: string;
	/** Process exit code */
	exitCode: number;
	/** Files created in the .llm/ temp directory, keyed by relative path */
	filesCreated: Record<string, string>;
}
