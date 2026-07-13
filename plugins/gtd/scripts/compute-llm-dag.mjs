#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {addInterval, buildTimeElement, parseTimeISO, swapTimeElement} from './compute-overdue.mjs';

const ROOT_NAMES = ['Import', 'Prep', 'Presentation'];
const INTERVAL_PREFIX = 'Interval: ';
const INTERVAL_PATTERN = /^(\d+)([dmy])$/;
const TASK_COMMAND_PATTERN = /^\/[a-z0-9-]+:([a-z0-9-]+)(?:\s|$)/;

const shellSingleQuote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;

const markerChildren = (node, prefix) => (node.children ?? []).filter((child) => String(child.name).startsWith(prefix));

function optionalMarker(node, prefix, context) {
	const matches = markerChildren(node, prefix);
	if (matches.length > 1) throw new Error(`${context} has multiple ${prefix.trim()} markers`);
	return matches[0]?.name.slice(prefix.length) ?? null;
}

function parseInterval(node, context) {
	const value = optionalMarker(node, INTERVAL_PREFIX, context);
	if (value === null) return {amount: 1, unit: 'd'};
	const match = value.match(INTERVAL_PATTERN);
	if (!match || Number(match[1]) === 0) throw new Error(`${context} has invalid interval "${value}"`);
	return {amount: Number(match[1]), unit: match[2]};
}

function isMarker(child) {
	const name = String(child.name);
	return name.startsWith(INTERVAL_PREFIX) || name === 'Auto';
}

function instructions(node, context) {
	const obsoleteKey = (node.children ?? []).find((child) => String(child.name).startsWith('Key:'));
	if (obsoleteKey) throw new Error(`${context} has obsolete Key marker "${obsoleteKey.name}"`);
	const result = (node.children ?? []).filter((child) => !isMarker(child) && String(child.name).trim() !== '');
	if (result.length === 0) throw new Error(`${context} has no instructions`);
	return result;
}

function taskDisplayName(name) {
	return String(name)
		.replace(/<time[^>]*>.*?<\/time>\s*/g, '')
		.trim();
}

function taskSlug(taskInstructions, context) {
	const commandSlugs = taskInstructions
		.map((instruction) => String(instruction.name).trim().match(TASK_COMMAND_PATTERN)?.[1])
		.filter(Boolean);
	if (commandSlugs.length !== 1) throw new Error(`${context} must have exactly one plugin command`);
	return commandSlugs[0].replace(/-(?:prep|auto)$/, '');
}

function parsePrepTask(node, today) {
	const name = taskDisplayName(node.name);
	const context = `prep task "${name}"`;
	const taskInstructions = instructions(node, context);
	const slug = taskSlug(taskInstructions, context);
	const dueDate = parseTimeISO(node.name);
	if (dueDate === null) throw new Error(`${context} is missing its date`);
	const interval = parseInterval(node, context);
	const autoMarkers = (node.children ?? []).filter((child) => child.name === 'Auto');
	if (autoMarkers.length > 1) throw new Error(`${context} has multiple Auto markers`);
	const due = node.completedAt === null && dueDate <= today;
	const nextDate = addInterval(today, interval);
	const newName = swapTimeElement(node.name, buildTimeElement(nextDate));

	return {
		slug,
		name,
		id: node.id,
		shortId: node.shortId,
		instructions: taskInstructions,
		auto: autoMarkers.length === 1,
		due,
		dueDate,
		interval,
		advance: {
			nextDate,
			newName,
			applyOp: `./bin/run.js node update --id ${node.id} --name ${shellSingleQuote(newName)} --expect-name ${shellSingleQuote(node.name)}`,
		},
	};
}

function parsePresentationTask(node) {
	const name = taskDisplayName(node.name);
	const context = `presentation task "${name}"`;
	if (parseTimeISO(node.name) !== null) {
		throw new Error(`${context} must inherit its date from prep`);
	}
	if (markerChildren(node, INTERVAL_PREFIX).length > 0) {
		throw new Error(`${context} must inherit its interval from prep`);
	}
	if ((node.children ?? []).some((child) => child.name === 'Auto')) {
		throw new Error(`${context} cannot be Auto`);
	}
	return {
		name,
		id: node.id,
		shortId: node.shortId,
		instructions: instructions(node, context),
	};
}

function uniqueBy(tasks, property, context) {
	const result = new Map();
	for (const task of tasks) {
		const value = task[property];
		if (result.has(value)) throw new Error(`${context} has duplicate ${property} "${value}"`);
		result.set(value, task);
	}
	return result;
}

function rootGroups(tree) {
	const children = tree.children ?? [];
	const unexpected = children.filter((child) => !ROOT_NAMES.includes(child.name));
	if (unexpected.length > 0) {
		throw new Error(`LLM Tasks has unexpected child "${taskDisplayName(unexpected[0].name)}"`);
	}
	const groups = new Map();
	for (const name of ROOT_NAMES) {
		const matches = children.filter((child) => child.name === name);
		if (matches.length !== 1) throw new Error(`LLM Tasks must contain exactly one ${name} node`);
		groups.set(name, matches[0]);
	}
	return groups;
}

export function computeLlmDag(tree, today) {
	const groups = rootGroups(tree);
	const importNode = groups.get('Import');
	const prepNode = groups.get('Prep');
	const presentationNode = groups.get('Presentation');
	const parsedBranches = (prepNode.children ?? []).map((child) => {
		if (String(child.name).startsWith('Serial: ')) {
			if ((child.children ?? []).length === 0) throw new Error(`serial group "${child.name}" is empty`);
			return {
				mode: 'serial',
				name: child.name.slice('Serial: '.length),
				tasks: child.children.map((task) => parsePrepTask(task, today)),
			};
		}
		return {mode: 'parallel', tasks: [parsePrepTask(child, today)]};
	});
	const allPrepTasks = parsedBranches.flatMap((branch) => branch.tasks);
	const allPresentationTasks = (presentationNode.children ?? []).map(parsePresentationTask);
	const prepByName = uniqueBy(allPrepTasks, 'name', 'Prep');
	uniqueBy(allPrepTasks, 'slug', 'Prep');
	const presentationByName = uniqueBy(allPresentationTasks, 'name', 'Presentation');

	for (const prepTask of allPrepTasks) {
		if (prepTask.auto && presentationByName.has(prepTask.name)) {
			throw new Error(`auto prep task "${prepTask.name}" must not have a presentation task`);
		}
		if (!prepTask.auto && !presentationByName.has(prepTask.name)) {
			throw new Error(`prep task "${prepTask.name}" has no matching presentation task`);
		}
	}
	for (const presentationTask of allPresentationTasks) {
		if (!prepByName.has(presentationTask.name)) {
			throw new Error(`presentation task "${presentationTask.name}" has no matching prep task`);
		}
	}

	const prepBranches = parsedBranches
		.map((branch) => ({...branch, tasks: branch.tasks.filter((task) => task.due)}))
		.filter((branch) => branch.tasks.length > 0);
	const dueNames = new Set(allPrepTasks.filter((task) => task.due).map((task) => task.name));
	const presentation = allPresentationTasks
		.filter((task) => dueNames.has(task.name))
		.map((task) => ({...task, slug: prepByName.get(task.name).slug}));
	const skipped = allPrepTasks
		.filter((task) => !task.due)
		.map((task) => ({
			slug: task.slug,
			reason: task.dueDate > today ? 'future' : 'completed',
			dueDate: task.dueDate,
		}));

	return {
		import: {
			id: importNode.id,
			instructions: instructions(importNode, 'Import'),
		},
		prepBranches,
		presentation,
		skipped,
	};
}

function localToday() {
	const now = new Date();
	const pad = (value) => String(value).padStart(2, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function main(arguments_) {
	const argumentsList = arguments_.slice(2);
	let inputPath = '.llm/gtd/review/phase0-llm-tasks.json';
	let today = localToday();
	for (let index = 0; index < argumentsList.length; index++) {
		if (argumentsList[index] === '--today') today = argumentsList[++index];
		else if (!argumentsList[index].startsWith('--')) inputPath = argumentsList[index];
		else throw new Error(`unknown option: ${argumentsList[index]}`);
	}
	const tree = JSON.parse(readFileSync(inputPath, 'utf8'));
	process.stdout.write(`${JSON.stringify(computeLlmDag(tree, today), null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
