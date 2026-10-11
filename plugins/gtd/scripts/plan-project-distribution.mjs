#!/usr/bin/env node
// Build the project table for the daily-review Distribute phase: each project's absolute path,
// its .llm/todo.md, its Workflowy tasks link and tags, and any herdr panes already open in it.
// Usage: plan-project-distribution.mjs --projects <project-directories.json> --panes <herdr-pane-list.json>
import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';

export function expandHome(path, home) {
	if (path === '~') return home;
	return path.startsWith('~/') ? `${home}${path.slice(1)}` : path;
}

const LINK = /<a href="https:\/\/workflowy\.com\/#\/([0-9a-f]+)">(.*?)<\/a>/;

export function parseProjectDirectories(exported, home) {
	return (exported.children ?? []).flatMap((project) => {
		const [pathChild, linkChild] = project.children ?? [];
		if (!pathChild) return [];
		const link = linkChild ? LINK.exec(linkChild.name) : null;
		const tasksName = link ? link[2] : null;
		return [
			{
				name: project.name,
				path: expandHome(pathChild.name.trim(), home),
				tasksShortId: link ? link[1] : null,
				tasksName,
				tags: tasksName ? (tasksName.match(/#[\w-]+/g) ?? []) : [],
			},
		];
	});
}

export function planProjects(projects, panes, todoExists) {
	return projects.map((project) => {
		const todoPath = `${project.path}/.llm/todo.md`;
		const openPanes = panes
			.filter((pane) => pane.cwd === project.path || pane.cwd?.startsWith(`${project.path}/`))
			.map((pane) => ({paneId: pane.pane_id, tabId: pane.tab_id, workspaceId: pane.workspace_id}));
		return {...project, todoPath, todoExists: todoExists(todoPath), openPanes};
	});
}

function main() {
	const args = process.argv.slice(2);
	const value = (flag) => {
		const index = args.indexOf(flag);
		if (index === -1 || !args[index + 1]) throw new Error(`${flag} <file> is required`);
		return args[index + 1];
	};
	const exported = JSON.parse(readFileSync(value('--projects'), 'utf8'));
	const paneList = JSON.parse(readFileSync(value('--panes'), 'utf8'));
	const panes = paneList.result?.panes ?? paneList.panes ?? [];
	const plan = planProjects(parseProjectDirectories(exported, homedir()), panes, existsSync);
	process.stdout.write(`${JSON.stringify(plan, null, '\t')}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		main();
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		process.exit(1);
	}
}
