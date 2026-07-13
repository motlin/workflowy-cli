#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {addInterval, buildTimeElement, parseTimeISO, swapTimeElement} from './compute-overdue.mjs';

const ROOT_NAMES = ['Import', 'Prep', 'Presentation'];
const KEY_PREFIX = 'Key: ';
const INTERVAL_PREFIX = 'Interval: ';
const INTERVAL_PATTERN = /^(\d+)([dmy])$/;

const shellSingleQuote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;

const markerChildren = (node, prefix) => (node.children ?? []).filter((child) => String(child.name).startsWith(prefix));

function singleMarker(node, prefix, context, required) {
	const matches = markerChildren(node, prefix);
	if (matches.length > 1) throw new Error(`${context} has multiple ${prefix.trim()} markers`);
	if (required && matches.length === 0) throw new Error(`${context} is missing ${prefix.trim()} marker`);
	return matches[0]?.name.slice(prefix.length) ?? null;
}

function parseInterval(node, context) {
	const value = singleMarker(node, INTERVAL_PREFIX, context, false);
	if (value === null) return {amount: 1, unit: 'd'};
	const match = value.match(INTERVAL_PATTERN);
	if (!match || Number(match[1]) === 0) throw new Error(`${context} has invalid interval "${value}"`);
	return {amount: Number(match[1]), unit: match[2]};
}

function isMarker(child) {
	const name = String(child.name);
	return name.startsWith(KEY_PREFIX) || name.startsWith(INTERVAL_PREFIX) || name === 'Auto';
}

function instructions(node, context) {
	const result = (node.children ?? []).filter((child) => !isMarker(child) && String(child.name).trim() !== '');
	if (result.length === 0) throw new Error(`${context} has no instructions`);
	return result;
}

function taskDisplayName(name) {
	return String(name)
		.replace(/<time[^>]*>.*?<\/time>\s*/g, '')
		.trim();
}

function parsePrepTask(node, today) {
	const context = `prep task "${taskDisplayName(node.name)}"`;
	const key = singleMarker(node, KEY_PREFIX, context, true);
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) throw new Error(`${context} has invalid key "${key}"`);
	const dueDate = parseTimeISO(node.name);
	if (dueDate === null) throw new Error(`prep key "${key}" is missing its date`);
	const interval = parseInterval(node, `prep key "${key}"`);
	const autoMarkers = (node.children ?? []).filter((child) => child.name === 'Auto');
	if (autoMarkers.length > 1) throw new Error(`prep key "${key}" has multiple Auto markers`);
	const due = node.completedAt === null && dueDate <= today;
	const nextDate = addInterval(today, interval);
	const newName = swapTimeElement(node.name, buildTimeElement(nextDate));

	return {
		key,
		name: taskDisplayName(node.name),
		id: node.id,
		shortId: node.shortId,
		instructions: instructions(node, `prep key "${key}"`),
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
	const context = `presentation task "${taskDisplayName(node.name)}"`;
	const key = singleMarker(node, KEY_PREFIX, context, true);
	if (parseTimeISO(node.name) !== null) {
		throw new Error(`presentation key "${key}" must inherit its date from prep`);
	}
	if (markerChildren(node, INTERVAL_PREFIX).length > 0) {
		throw new Error(`presentation key "${key}" must inherit its interval from prep`);
	}
	if ((node.children ?? []).some((child) => child.name === 'Auto')) {
		throw new Error(`presentation key "${key}" cannot be Auto`);
	}
	return {
		key,
		name: taskDisplayName(node.name),
		id: node.id,
		shortId: node.shortId,
		instructions: instructions(node, `presentation key "${key}"`),
	};
}

function uniqueByKey(tasks, context) {
	const result = new Map();
	for (const task of tasks) {
		if (result.has(task.key)) throw new Error(`${context} has duplicate key "${task.key}"`);
		result.set(task.key, task);
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
	const prepByKey = uniqueByKey(allPrepTasks, 'Prep');
	const presentationByKey = uniqueByKey(allPresentationTasks, 'Presentation');

	for (const prepTask of allPrepTasks) {
		if (prepTask.auto && presentationByKey.has(prepTask.key)) {
			throw new Error(`auto prep key "${prepTask.key}" must not have a presentation task`);
		}
		if (!prepTask.auto && !presentationByKey.has(prepTask.key)) {
			throw new Error(`prep key "${prepTask.key}" has no presentation task`);
		}
	}
	for (const presentationTask of allPresentationTasks) {
		if (!prepByKey.has(presentationTask.key)) {
			throw new Error(`presentation key "${presentationTask.key}" has no prep task`);
		}
	}

	const prepBranches = parsedBranches
		.map((branch) => ({...branch, tasks: branch.tasks.filter((task) => task.due)}))
		.filter((branch) => branch.tasks.length > 0);
	const dueKeys = new Set(allPrepTasks.filter((task) => task.due).map((task) => task.key));
	const presentation = allPresentationTasks.filter((task) => dueKeys.has(task.key));
	const skipped = allPrepTasks
		.filter((task) => !task.due)
		.map((task) => ({
			key: task.key,
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
