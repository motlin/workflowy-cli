import {parseMarkdownContent, resolveCommandId} from './markdown-parser.js';

describe('markdown-parser', () => {
	describe('resolveCommandId', () => {
		it('resolves two-word command to colon-separated ID', () => {
			const result = resolveCommandId(['node', 'create']);
			expect(result.command).toBe('node:create');
			expect(result.remaining).toStrictEqual([]);
		});

		it('resolves three-word command', () => {
			const result = resolveCommandId(['workflowy', 'utils', 'path-to-id']);
			expect(result.command).toBe('workflowy:utils:path-to-id');
			expect(result.remaining).toStrictEqual([]);
		});

		it('resolves four-word command', () => {
			const result = resolveCommandId(['gtd', 'cache', 'data', 'source']);
			expect(result.command).toBe('gtd:cache:data:source');
			expect(result.remaining).toStrictEqual([]);
		});

		it('returns remaining tokens after command resolution', () => {
			const result = resolveCommandId(['node', 'list']);
			expect(result.command).toBe('node:list');
			expect(result.remaining).toStrictEqual([]);
		});

		it('handles single-word command with flag following', () => {
			const result = resolveCommandId(['--help']);
			// Starts with -, so no command words found
			expect(result.command).toBe('--help');
		});
	});

	describe('CLI invocation extraction', () => {
		it('extracts a simple CLI invocation', () => {
			const analysis = parseMarkdownContent('test.md', './bin/run.js node list --verbose');
			expect(analysis.cliInvocations).toHaveLength(1);
			expect(analysis.cliInvocations[0].command).toBe('node:list');
			expect(analysis.cliInvocations[0].flags).toContain('verbose');
			expect(analysis.cliInvocations[0].line).toBe(1);
		});

		it('extracts CLI invocation with short flags', () => {
			const analysis = parseMarkdownContent('test.md', './bin/run.js node get -i abc123');
			expect(analysis.cliInvocations).toHaveLength(1);
			expect(analysis.cliInvocations[0].command).toBe('node:get');
			expect(analysis.cliInvocations[0].flags).toContain('i');
		});

		it('handles multiline commands with continuation', () => {
			const content = [
				'./bin/run.js node create \\',
				'  --parent-path "Work,Tasks" \\',
				'  --name "New Task" \\',
				'  --verbose',
			].join('\n');
			const analysis = parseMarkdownContent('test.md', content);
			expect(analysis.cliInvocations).toHaveLength(1);
			expect(analysis.cliInvocations[0].command).toBe('node:create');
			expect(analysis.cliInvocations[0].flags).toContain('parent-path');
			expect(analysis.cliInvocations[0].flags).toContain('name');
			expect(analysis.cliInvocations[0].flags).toContain('verbose');
			expect(analysis.cliInvocations[0].line).toBe(1);
		});

		it('handles LOG_LEVEL prefix before ./bin/run.js', () => {
			const analysis = parseMarkdownContent('test.md', 'LOG_LEVEL=fatal ./bin/run.js node list --json');
			expect(analysis.cliInvocations).toHaveLength(1);
			expect(analysis.cliInvocations[0].command).toBe('node:list');
			expect(analysis.cliInvocations[0].flags).toContain('json');
		});

		it('handles pipe with xargs leading to second invocation', () => {
			const content =
				'./bin/run.js workflowy utils path-to-id --path "Next Actions" --data-source cache | xargs -I{} ./bin/run.js node list --parent-id {} --verbose';
			const analysis = parseMarkdownContent('test.md', content);
			expect(analysis.cliInvocations).toHaveLength(2);
			expect(analysis.cliInvocations[0].command).toBe('workflowy:utils:path-to-id');
			expect(analysis.cliInvocations[0].flags).toContain('path');
			expect(analysis.cliInvocations[0].flags).toContain('data-source');
			expect(analysis.cliInvocations[1].command).toBe('node:list');
			expect(analysis.cliInvocations[1].flags).toContain('parent-id');
			expect(analysis.cliInvocations[1].flags).toContain('verbose');
		});

		it('stops parsing flags at pipe', () => {
			const analysis = parseMarkdownContent('test.md', './bin/run.js node list --verbose | jq .name');
			expect(analysis.cliInvocations).toHaveLength(1);
			expect(analysis.cliInvocations[0].flags).toStrictEqual(['verbose']);
		});

		it('stops parsing flags at redirect', () => {
			const analysis = parseMarkdownContent('test.md', './bin/run.js node list --verbose 2>/dev/null');
			expect(analysis.cliInvocations).toHaveLength(1);
			expect(analysis.cliInvocations[0].flags).toContain('verbose');
		});

		it('handles --no- prefix for boolean flags', () => {
			const analysis = parseMarkdownContent('test.md', './bin/run.js node list --no-cache --verbose');
			expect(analysis.cliInvocations).toHaveLength(1);
			expect(analysis.cliInvocations[0].flags).toContain('cache');
			expect(analysis.cliInvocations[0].flags).toContain('verbose');
		});

		it('handles --flag=value syntax', () => {
			const analysis = parseMarkdownContent('test.md', './bin/run.js cache import-backup --format=json');
			expect(analysis.cliInvocations).toHaveLength(1);
			expect(analysis.cliInvocations[0].command).toBe('cache:import-backup');
			expect(analysis.cliInvocations[0].flags).toContain('format');
		});

		it('skips variable substitution values', () => {
			const analysis = parseMarkdownContent('test.md', './bin/run.js node get --id $ITEM_ID');
			expect(analysis.cliInvocations).toHaveLength(1);
			expect(analysis.cliInvocations[0].command).toBe('node:get');
			expect(analysis.cliInvocations[0].flags).toContain('id');
		});

		it('handles three-word command (workflowy utils path-to-id)', () => {
			const analysis = parseMarkdownContent('test.md', './bin/run.js workflowy utils path-to-id --path "Test"');
			expect(analysis.cliInvocations).toHaveLength(1);
			expect(analysis.cliInvocations[0].command).toBe('workflowy:utils:path-to-id');
			expect(analysis.cliInvocations[0].flags).toContain('path');
		});

		it('strips closing code-span backtick and trailing colon from command', () => {
			const analysis = parseMarkdownContent('test.md', 'Add, via `./bin/run.js node create`:');
			expect(analysis.cliInvocations).toHaveLength(1);
			expect(analysis.cliInvocations[0].command).toBe('node:create');
		});

		it('handles lines without ./bin/run.js', () => {
			const analysis = parseMarkdownContent('test.md', 'This is a normal line without CLI commands.');
			expect(analysis.cliInvocations).toHaveLength(0);
		});

		it('handles --help and --version as global flags', () => {
			const analysis = parseMarkdownContent('test.md', './bin/run.js --help');
			expect(analysis.cliInvocations).toHaveLength(1);
			expect(analysis.cliInvocations[0].command).toBe('');
			expect(analysis.cliInvocations[0].flags).toContain('help');
		});

		it('reports correct line numbers for multiple invocations', () => {
			const content = [
				'Some text',
				'./bin/run.js node get --id abc',
				'More text',
				'./bin/run.js node list --verbose',
			].join('\n');
			const analysis = parseMarkdownContent('test.md', content);
			expect(analysis.cliInvocations).toHaveLength(2);
			expect(analysis.cliInvocations[0].line).toBe(2);
			expect(analysis.cliInvocations[1].line).toBe(4);
		});

		it('preserves raw text of the invocation', () => {
			const analysis = parseMarkdownContent('test.md', '  ./bin/run.js node list --verbose');
			expect(analysis.cliInvocations[0].raw).toBe('./bin/run.js node list --verbose');
		});
	});

	describe('subagent reference extraction', () => {
		it('extracts double-quoted subagent_type', () => {
			const analysis = parseMarkdownContent('test.md', '- subagent_type: "metadata-sync"');
			expect(analysis.subagentRefs).toHaveLength(1);
			expect(analysis.subagentRefs[0].name).toBe('metadata-sync');
			expect(analysis.subagentRefs[0].line).toBe(1);
		});

		it('extracts single-quoted subagent_type', () => {
			const analysis = parseMarkdownContent('test.md', "- subagent_type: 'item-refiner'");
			expect(analysis.subagentRefs).toHaveLength(1);
			expect(analysis.subagentRefs[0].name).toBe('item-refiner');
		});

		it('extracts multiple subagent_type references', () => {
			const content = [
				'- subagent_type: "inbox-loader"',
				'  prompt: "Load items"',
				'- subagent_type: "metadata-sync"',
				'  prompt: "Sync metadata"',
			].join('\n');
			const analysis = parseMarkdownContent('test.md', content);
			expect(analysis.subagentRefs).toHaveLength(2);
			expect(analysis.subagentRefs[0].name).toBe('inbox-loader');
			expect(analysis.subagentRefs[1].name).toBe('metadata-sync');
		});

		it('ignores lines without subagent_type', () => {
			const analysis = parseMarkdownContent('test.md', 'This mentions subagent but not the right pattern');
			expect(analysis.subagentRefs).toHaveLength(0);
		});
	});

	describe('.llm/ path extraction', () => {
		it('extracts .llm/ paths', () => {
			const analysis = parseMarkdownContent('test.md', 'Write to `.llm/gtd/inbox-ids.txt`');
			expect(analysis.llmPaths).toHaveLength(1);
			expect(analysis.llmPaths[0].path).toBe('.llm/gtd/inbox-ids.txt');
		});

		it('extracts .llm/ paths with leading ./', () => {
			const analysis = parseMarkdownContent('test.md', 'Read `./.llm/gtd/metadata/`');
			expect(analysis.llmPaths).toHaveLength(1);
			expect(analysis.llmPaths[0].path).toBe('.llm/gtd/metadata/');
		});

		it('extracts multiple .llm/ paths from different lines', () => {
			const content = ['`.llm/gtd/inbox-ids.txt` - inbox items', '`.llm/gtd/metadata/` - metadata cache'].join(
				'\n',
			);
			const analysis = parseMarkdownContent('test.md', content);
			expect(analysis.llmPaths).toHaveLength(2);
		});

		it('handles paths in quotes', () => {
			const analysis = parseMarkdownContent('test.md', 'Write to ".llm/gtd/capture/analysis/"');
			expect(analysis.llmPaths).toHaveLength(1);
			expect(analysis.llmPaths[0].path).toBe('.llm/gtd/capture/analysis/');
		});
	});

	describe('command reference extraction', () => {
		it('extracts /gtd:inbox reference', () => {
			const analysis = parseMarkdownContent('test.md', 'Run `/gtd:inbox` to execute moves.');
			expect(analysis.commandRefs).toHaveLength(1);
			expect(analysis.commandRefs[0].ref).toBe('/gtd:inbox');
		});

		it('extracts /gtd:refine reference', () => {
			const analysis = parseMarkdownContent('test.md', 'First run `/gtd:refine` to analyze items.');
			expect(analysis.commandRefs).toHaveLength(1);
			expect(analysis.commandRefs[0].ref).toBe('/gtd:refine');
		});

		it('extracts /gtd:capture reference', () => {
			const analysis = parseMarkdownContent('test.md', '- `/gtd:capture` - Capture new items');
			expect(analysis.commandRefs).toHaveLength(1);
			expect(analysis.commandRefs[0].ref).toBe('/gtd:capture');
		});

		it('handles multi-segment command refs', () => {
			const analysis = parseMarkdownContent('test.md', 'Use `/workflowy:upload-attachment`');
			expect(analysis.commandRefs).toHaveLength(1);
			expect(analysis.commandRefs[0].ref).toBe('/workflowy:upload-attachment');
		});

		it('does not match single-segment slash paths', () => {
			// /gtd alone is not a valid command ref (needs colon)
			const analysis = parseMarkdownContent('test.md', 'The /dev/null path');
			expect(analysis.commandRefs).toHaveLength(0);
		});
	});

	describe('script reference extraction', () => {
		it('extracts .claude/scripts/ references', () => {
			const analysis = parseMarkdownContent('test.md', 'Run `.claude/scripts/gtd/load-inboxes.sh`');
			expect(analysis.scriptRefs).toHaveLength(1);
			expect(analysis.scriptRefs[0].path).toBe('.claude/scripts/gtd/load-inboxes.sh');
		});

		it('extracts ./.claude/scripts/ references with leading ./', () => {
			const analysis = parseMarkdownContent('test.md', './.claude/scripts/gtd/load-inboxes.sh');
			expect(analysis.scriptRefs).toHaveLength(1);
			expect(analysis.scriptRefs[0].path).toBe('.claude/scripts/gtd/load-inboxes.sh');
		});

		it('extracts multiple script references', () => {
			const content = ['`.claude/scripts/gtd/sync-metadata.sh`', '`.claude/scripts/gtd/load-declined.sh`'].join(
				'\n',
			);
			const analysis = parseMarkdownContent('test.md', content);
			expect(analysis.scriptRefs).toHaveLength(2);
		});

		it('extracts ${CLAUDE_PLUGIN_ROOT}/scripts/ references', () => {
			const analysis = parseMarkdownContent('test.md', 'Run `${CLAUDE_PLUGIN_ROOT}/scripts/sync-metadata.sh`');
			expect(analysis.scriptRefs).toHaveLength(1);
			expect(analysis.scriptRefs[0].path).toBe('${CLAUDE_PLUGIN_ROOT}/scripts/sync-metadata.sh');
		});
	});

	describe('threshold extraction', () => {
		it('extracts >= 0.85 threshold', () => {
			const analysis = parseMarkdownContent('test.md', 'Confidence >= 0.85 AND no duplicate');
			expect(analysis.thresholds).toHaveLength(1);
			expect(analysis.thresholds[0].value).toBe(0.85);
			expect(analysis.thresholds[0].context).toContain('Confidence');
		});

		it('extracts >= 0.9 threshold', () => {
			const analysis = parseMarkdownContent('test.md', '**High confidence (>= 0.9)**: Auto-accept');
			expect(analysis.thresholds).toHaveLength(1);
			expect(analysis.thresholds[0].value).toBe(0.9);
		});

		it('extracts multiple thresholds from different lines', () => {
			const content = [
				'Confidence >= 0.85 for capture',
				'Confidence >= 0.9 for auto-accept',
				'Confidence >= 0.5 for tags',
			].join('\n');
			const analysis = parseMarkdownContent('test.md', content);
			expect(analysis.thresholds).toHaveLength(3);
			expect(analysis.thresholds.map((t) => t.value)).toStrictEqual([0.85, 0.9, 0.5]);
		});

		it('extracts > 0.7 threshold (without equals)', () => {
			const analysis = parseMarkdownContent('test.md', 'Confidence > 0.7 for dates');
			expect(analysis.thresholds).toHaveLength(1);
			expect(analysis.thresholds[0].value).toBe(0.7);
		});

		it('reports correct line numbers', () => {
			const content = ['Line 1', 'Confidence >= 0.85', 'Line 3'].join('\n');
			const analysis = parseMarkdownContent('test.md', content);
			expect(analysis.thresholds[0].line).toBe(2);
		});

		it('does not extract values > 1.0', () => {
			const analysis = parseMarkdownContent('test.md', 'version >= 0.0 is invalid');
			expect(analysis.thresholds).toHaveLength(0);
		});
	});

	describe('full file parsing', () => {
		it('extracts all reference types from a realistic markdown file', () => {
			const content = `---
name: refine
description: GTD inbox refinement
---

# Refinement Command

Launch loaders:
\`\`\`
Task tool calls (parallel):
- subagent_type: "inbox-loader"
  prompt: "Load items to .llm/gtd/inbox-ids.txt"
- subagent_type: "metadata-sync"
  prompt: "Sync metadata to .llm/gtd/metadata/"
\`\`\`

Run the CLI:
\`\`\`bash
./bin/run.js node list \\
  --parent-id {} \\
  --verbose
\`\`\`

Run sync script:
\`\`\`bash
.claude/scripts/gtd/sync-metadata.sh
\`\`\`

Confidence >= 0.85 for capture decisions.

See also \`/gtd:inbox\` for execution.
`;
			const analysis = parseMarkdownContent('test.md', content);

			expect(analysis.cliInvocations).toHaveLength(1);
			expect(analysis.cliInvocations[0].command).toBe('node:list');

			expect(analysis.subagentRefs).toHaveLength(2);
			expect(analysis.subagentRefs[0].name).toBe('inbox-loader');
			expect(analysis.subagentRefs[1].name).toBe('metadata-sync');

			expect(analysis.llmPaths.length).toBeGreaterThanOrEqual(2);

			expect(analysis.scriptRefs).toHaveLength(1);
			expect(analysis.scriptRefs[0].path).toBe('.claude/scripts/gtd/sync-metadata.sh');

			expect(analysis.thresholds).toHaveLength(1);
			expect(analysis.thresholds[0].value).toBe(0.85);

			expect(analysis.commandRefs).toHaveLength(1);
			expect(analysis.commandRefs[0].ref).toBe('/gtd:inbox');
		});
	});
});
