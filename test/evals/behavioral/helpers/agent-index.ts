/**
 * Agent index for resolving subagent_type strings to agent markdown files.
 *
 * Scans `.claude/agents/` directory at initialization time and builds
 * a lookup index by:
 * - `name` frontmatter field (e.g., "item-refiner", "metadata-sync")
 * - Relative path with colons (e.g., "gtd/refinement/item-refiner")
 * - Relative path with slashes (e.g., "gtd/refinement/item-refiner")
 */

import fs from 'node:fs';
import path from 'node:path';
import type {AgentIndex, AgentIndexEntry} from './eval-types.js';

/**
 * Parse an agent markdown file to extract frontmatter and system prompt.
 * Duplicated here to avoid circular dependency with llm-eval-harness.
 */
function parseAgentMarkdown(filePath: string): {
	frontmatter: Record<string, unknown>;
	systemPrompt: string;
} {
	const content = fs.readFileSync(filePath, 'utf8');

	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!frontmatterMatch) {
		return {frontmatter: {}, systemPrompt: content};
	}

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
 * Recursively find all .md files in a directory.
 */
function findMarkdownFiles(dir: string): string[] {
	const results: string[] = [];
	if (!fs.existsSync(dir)) return results;

	for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...findMarkdownFiles(fullPath));
		} else if (entry.name.endsWith('.md')) {
			results.push(fullPath);
		}
	}

	return results;
}

/**
 * Build an agent index by scanning plugin agent directories
 * (`plugins/<plugin>/agents/**\/*.md`) plus any project-local
 * `.claude/agents/**\/*.md` files.
 *
 * Each agent is indexed by multiple keys:
 * - Its `name` frontmatter field (e.g., "project-tagger")
 * - Its plugin-qualified name (e.g., "gtd:project-tagger")
 * - Its relative path without extension, using slashes and colons
 *
 * @param projectRoot - The project root directory
 * @returns An AgentIndex with all discovered agents
 */
export function buildAgentIndex(projectRoot: string): AgentIndex {
	const entries = new Map<string, AgentIndexEntry>();

	const scanRoots: Array<{agentsDir: string; pluginName?: string}> = [
		{agentsDir: path.join(projectRoot, '.claude', 'agents')},
	];
	const pluginsDir = path.join(projectRoot, 'plugins');
	if (fs.existsSync(pluginsDir)) {
		for (const entry of fs.readdirSync(pluginsDir, {withFileTypes: true})) {
			if (entry.isDirectory()) {
				scanRoots.push({
					agentsDir: path.join(pluginsDir, entry.name, 'agents'),
					pluginName: entry.name,
				});
			}
		}
	}

	for (const {agentsDir, pluginName} of scanRoots) {
		for (const filePath of findMarkdownFiles(agentsDir)) {
			try {
				const {frontmatter, systemPrompt} = parseAgentMarkdown(filePath);
				const name = (frontmatter.name as string) ?? path.basename(filePath, '.md');

				const entry: AgentIndexEntry = {
					name,
					filePath,
					systemPrompt,
					frontmatter,
				};

				// Index by name, and by plugin-qualified name (e.g. "gtd:item-refiner")
				entries.set(name, entry);
				if (pluginName) {
					entries.set(`${pluginName}:${name}`, entry);
				}

				// Index by relative path (slashes and colons)
				const relativePath = path.relative(agentsDir, filePath).replace(/\.md$/, '');
				entries.set(relativePath, entry);
				entries.set(relativePath.replaceAll('/', ':'), entry);

				// Also index by just the filename without extension
				const basename = path.basename(filePath, '.md');
				if (!entries.has(basename)) {
					entries.set(basename, entry);
				}
			} catch {
				// Skip files that can't be parsed
			}
		}
	}

	return {entries};
}

/**
 * Resolve a subagent_type string to an agent index entry.
 *
 * Tries multiple resolution strategies:
 * - Direct lookup by name
 * - Lookup by relative path (slashes)
 * - Lookup by relative path (colons)
 * - Fuzzy match (contains)
 *
 * @param subagentType - The subagent_type string from a task tool call
 * @param index - The pre-built agent index
 * @returns The resolved agent entry, or undefined if not found
 */
export function resolveAgent(subagentType: string, index: AgentIndex): AgentIndexEntry | undefined {
	// Direct lookup
	const direct = index.entries.get(subagentType);
	if (direct) return direct;

	// Try with slashes instead of colons
	const withSlashes = subagentType.replaceAll(':', '/');
	const slashLookup = index.entries.get(withSlashes);
	if (slashLookup) return slashLookup;

	// Try with colons instead of slashes
	const withColons = subagentType.replaceAll('/', ':');
	const colonLookup = index.entries.get(withColons);
	if (colonLookup) return colonLookup;

	// Fuzzy match: check if any key ends with the subagent type
	for (const [key, entry] of index.entries) {
		if (key.endsWith(subagentType) || key.endsWith(`/${subagentType}`) || key.endsWith(`:${subagentType}`)) {
			return entry;
		}
	}

	return undefined;
}
