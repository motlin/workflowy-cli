/**
 * Database setup for behavioral evals.
 *
 * Copies the real workflowy.sqlite to a temp directory and configures
 * environment variables so CLI commands and scripts read from the copy.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {EvalContext} from './eval-types.js';
import type {AgentIndex} from './eval-types.js';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../../..');

/**
 * Creates an isolated eval context with a copy of the production database.
 *
 * - Copies workflowy.sqlite to a temp directory
 * - Creates a temp .llm/ directory for intermediate files
 * - Sets WORKFLOWY_DB_PATH so CLI commands use the copy
 * - Unsets WORKFLOWY_API_KEY to prevent accidental API calls
 *
 * Source DB is configurable via WORKFLOWY_EVAL_SOURCE_DB env var.
 *
 * @param options - Optional configuration
 * @param options.agentIndex - Pre-built agent index for subagent resolution
 * @param options.mockServerPort - Port for the mock Workflowy HTTP server
 */
export function createEvalContext(options?: {agentIndex?: AgentIndex; mockServerPort?: number}): EvalContext {
	const sourceDb = process.env.WORKFLOWY_EVAL_SOURCE_DB || path.join(PROJECT_ROOT, 'workflowy.sqlite');

	if (!fs.existsSync(sourceDb)) {
		throw new Error(
			`Eval source database not found at ${sourceDb}. ` +
				'Set WORKFLOWY_EVAL_SOURCE_DB to point to a valid workflowy.sqlite file.',
		);
	}

	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflowy-eval-'));
	const dbPath = path.join(tempDir, 'workflowy.sqlite');
	const llmDir = path.join(tempDir, '.llm');

	// Copy database to temp directory
	fs.copyFileSync(sourceDb, dbPath);

	// Create .llm/ directory structure
	fs.mkdirSync(path.join(llmDir, 'gtd'), {recursive: true});

	const env: Record<string, string> = {
		WORKFLOWY_DB_PATH: dbPath,
	};

	// If a mock server port is provided, configure API URL and key for write-through
	if (options?.mockServerPort) {
		env.WORKFLOWY_API_KEY = 'eval-test-key';
		env.WORKFLOWY_API_URL = `http://localhost:${options.mockServerPort}`;
		env.WORKFLOWY_DATA_SOURCE = 'cache';
	}

	const cleanup = () => {
		fs.rmSync(tempDir, {force: true, recursive: true});
	};

	return {
		cleanup,
		dbPath,
		env,
		llmDir,
		projectRoot: PROJECT_ROOT,
		agentIndex: options?.agentIndex,
		apiCallCount: 0,
		mockServerPort: options?.mockServerPort,
	};
}

/**
 * Runs a shell command in the eval context.
 *
 * Sets up environment variables and working directory so the command
 * reads from the temp database and writes intermediate files to the
 * temp .llm/ directory.
 */
export async function runInEvalContext(
	ctx: EvalContext,
	command: string,
): Promise<{exitCode: number; stderr: string; stdout: string}> {
	const {execSync} = await import('node:child_process');

	// Build environment: inherit current env, overlay eval-specific vars,
	// and explicitly remove WORKFLOWY_API_KEY (unless mock server provides one)
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
			timeout: 60_000,
		});
		return {exitCode: 0, stderr: '', stdout};
	} catch (error: unknown) {
		const execError = error as {
			status?: number;
			stdout?: string;
			stderr?: string;
		};
		return {
			exitCode: execError.status ?? 1,
			stderr: execError.stderr ?? '',
			stdout: execError.stdout ?? '',
		};
	}
}

/**
 * Collects files created in the temp .llm/ directory.
 * Returns a map of relative paths to file contents.
 */
export function collectCreatedFiles(ctx: EvalContext): Record<string, string> {
	const files: Record<string, string> = {};

	function walk(dir: string, prefix: string): void {
		if (!fs.existsSync(dir)) return;
		for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
			const relativePath = path.join(prefix, entry.name);
			if (entry.isDirectory()) {
				walk(path.join(dir, entry.name), relativePath);
			} else {
				files[relativePath] = fs.readFileSync(path.join(dir, entry.name), 'utf8');
			}
		}
	}

	walk(ctx.llmDir, '.llm');
	return files;
}
