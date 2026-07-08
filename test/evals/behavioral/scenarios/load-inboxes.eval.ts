/**
 * Behavioral eval: gtd inboxes load command against local cache.
 *
 * Validates that the `gtd inboxes load` CLI command runs against the eval database,
 * reads inbox metadata from the cache, and produces a valid gtd-inboxes.json file
 * with optional children when --depth is specified.
 *
 * The command derives PROJECT_ROOT from its own location, so .llm/ output goes
 * to the real project root. We verify the command succeeds and produces output,
 * then clean up the generated file.
 */

import fs from 'node:fs';
import path from 'node:path';
import {createEvalContext, runInEvalContext} from '../helpers/eval-db-setup.js';
import type {EvalContext} from '../helpers/eval-types.js';

describe('Behavioral Eval: gtd inboxes load', () => {
	let ctx: EvalContext;
	let outputFile: string;

	beforeAll(() => {
		ctx = createEvalContext();
		outputFile = path.join(ctx.projectRoot, '.llm/gtd-inboxes.json');
	});

	afterAll(() => {
		ctx?.cleanup();
	});

	it('should run without errors against the eval database', {timeout: 60_000}, async () => {
		const result = await runInEvalContext(ctx, './bin/run.js gtd inboxes load --depth 3');

		expect(result.exitCode, `Command failed with stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
		expect(result.stdout).toContain('itemCount');
	});

	it('should produce a gtd-inboxes.json file with valid structure', {timeout: 60_000}, async () => {
		await runInEvalContext(ctx, './bin/run.js gtd inboxes load --depth 3');

		expect(fs.existsSync(outputFile), `Expected ${outputFile} to exist`).toBe(true);

		const content = fs.readFileSync(outputFile, 'utf8');
		const data = JSON.parse(content);

		// Validate top-level structure
		expect(data).toHaveProperty('loadedAt');
		expect(typeof data.loadedAt).toBe('string');
		expect(data).toHaveProperty('inboxes');
		expect(Array.isArray(data.inboxes)).toBe(true);
		expect(data).toHaveProperty('itemCount');
		expect(typeof data.itemCount).toBe('number');

		// Validate inbox structure
		expect(data.inboxes.length).toBeGreaterThan(0);
		for (const inbox of data.inboxes) {
			expect(inbox).toHaveProperty('id');
			expect(typeof inbox.id).toBe('string');
			expect(inbox).toHaveProperty('name');
			expect(typeof inbox.name).toBe('string');
			expect(inbox).toHaveProperty('items');
			expect(Array.isArray(inbox.items)).toBe(true);
		}

		// Validate item structure (items should have optional children)
		const allItems = data.inboxes.flatMap((inbox: {items: unknown[]}) => inbox.items);
		expect(allItems.length).toBeGreaterThan(0);
		for (const item of allItems) {
			expect(item).toHaveProperty('id');
			expect(typeof item.id).toBe('string');
			expect(item).toHaveProperty('name');
			expect(typeof item.name).toBe('string');
			// children is optional — if present, it should be an array
			if (item.children !== undefined) {
				expect(Array.isArray(item.children)).toBe(true);
			}
		}
	});

	it('should use cache data (not require API key)', {timeout: 60_000}, async () => {
		const result = await runInEvalContext(ctx, './bin/run.js gtd inboxes load --depth 3');

		// Should succeed even without WORKFLOWY_API_KEY
		expect(result.exitCode).toBe(0);
	});
});
