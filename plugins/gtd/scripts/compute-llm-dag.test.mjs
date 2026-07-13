// Run: node --test plugins/gtd/scripts/compute-llm-dag.test.mjs
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test test() calls are fire-and-forget by design */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {computeLlmDag} from './compute-llm-dag.mjs';

const time = (date, label) => {
	const [year, month, day] = date.split('-').map(Number);
	return `<time startYear="${year}" startMonth="${month}" startDay="${day}">${label}</time> `;
};

const instruction = (name) => ({name, children: []});

const task = ({name, id, date, command, interval, auto = false}) => ({
	name: `${name} ${time(date, 'Sat, Jan 1, 2000')}`,
	id,
	shortId: `${id}-short`,
	completedAt: null,
	children: [
		instruction(`/gtd:${command}`),
		...(interval ? [instruction(`Interval: ${interval}`)] : []),
		...(auto ? [instruction('Auto')] : []),
	],
});

const presentation = ({name, id, command}) => ({
	name,
	id,
	shortId: `${id}-short`,
	completedAt: null,
	children: [instruction(`/gtd:${command}`)],
});

const fixture = () => ({
	name: 'LLM Tasks:',
	children: [
		{
			name: 'Import',
			id: 'import',
			children: [instruction('op run -- just daily')],
		},
		{
			name: 'Prep',
			id: 'prep',
			children: [
				task({name: 'Daily task', id: 'daily', date: '2000-01-01', command: 'daily-prep'}),
				{
					name: 'Serial: calendar',
					id: 'serial',
					children: [
						task({
							name: 'Weekly task',
							id: 'weekly',
							date: '1999-12-31',
							command: 'weekly-prep',
							interval: '7d',
						}),
					],
				},
				task({name: 'Future auto task', id: 'future', date: '2000-01-02', command: 'future-auto', auto: true}),
			],
		},
		{
			name: 'Presentation',
			id: 'presentation',
			children: [
				presentation({name: 'Weekly task', id: 'weekly-presentation', command: 'weekly-apply'}),
				presentation({name: 'Daily task', id: 'daily-presentation', command: 'daily-apply'}),
			],
		},
	],
});

test('computeLlmDag inherits due state from prep and preserves presentation order', () => {
	const plan = computeLlmDag(fixture(), '2000-01-01');

	assert.deepEqual(
		plan.prepBranches.map((branch) => ({mode: branch.mode, slugs: branch.tasks.map((item) => item.slug)})),
		[
			{mode: 'parallel', slugs: ['daily']},
			{mode: 'serial', slugs: ['weekly']},
		],
	);
	assert.deepEqual(
		plan.presentation.map((item) => item.slug),
		['weekly', 'daily'],
	);
	assert.deepEqual(plan.skipped, [{slug: 'future', reason: 'future', dueDate: '2000-01-02'}]);
});

test('computeLlmDag defaults to daily and honors explicit weekly intervals', () => {
	const plan = computeLlmDag(fixture(), '2000-01-01');
	const tasks = plan.prepBranches.flatMap((branch) => branch.tasks);
	const daily = tasks.find((item) => item.slug === 'daily');
	const weekly = tasks.find((item) => item.slug === 'weekly');

	assert.deepEqual(daily.interval, {amount: 1, unit: 'd'});
	assert.equal(daily.advance.nextDate, '2000-01-02');
	assert.deepEqual(weekly.interval, {amount: 7, unit: 'd'});
	assert.equal(weekly.advance.nextDate, '2000-01-08');
	assert.match(weekly.advance.applyOp, /--id weekly/);
	assert.match(weekly.advance.applyOp, /--expect-name/);
});

test('computeLlmDag rejects unexpected root children', () => {
	const tree = fixture();
	tree.children.push(task({name: 'Orphan', id: 'orphan', date: '2000-01-01', command: 'orphan-prep'}));

	assert.throws(() => computeLlmDag(tree, '2000-01-01'), /unexpected child "Orphan/);
});

test('computeLlmDag rejects unmatched task names', () => {
	const tree = fixture();
	tree.children.find((child) => child.name === 'Presentation').children.pop();

	assert.throws(() => computeLlmDag(tree, '2000-01-01'), /prep task "Daily task" has no matching presentation task/);
});

test('computeLlmDag rejects dates on presentation tasks', () => {
	const tree = fixture();
	const item = tree.children.find((child) => child.name === 'Presentation').children[0];
	item.name += ` ${time('2000-01-01', 'Sat, Jan 1, 2000')}`;

	assert.throws(() => computeLlmDag(tree, '2000-01-01'), /presentation task "Weekly task" must inherit its date/);
});

test('computeLlmDag rejects invalid intervals', () => {
	const tree = fixture();
	const item = tree.children.find((child) => child.name === 'Prep').children[0];
	item.children.push(instruction('Interval: weekly'));

	assert.throws(() => computeLlmDag(tree, '2000-01-01'), /invalid interval "weekly"/);
});

test('computeLlmDag rejects a presentation task for an auto prep task', () => {
	const tree = fixture();
	tree.children
		.find((child) => child.name === 'Presentation')
		.children.push(presentation({name: 'Future auto task', id: 'future-presentation', command: 'future-apply'}));

	assert.throws(
		() => computeLlmDag(tree, '2000-01-01'),
		/auto prep task "Future auto task" must not have a presentation task/,
	);
});

test('computeLlmDag infers the artifact slug from the prep command', () => {
	const tree = fixture();
	const prep = tree.children.find((child) => child.name === 'Prep');
	prep.children.unshift(
		task({name: 'Refine exercise', id: 'exercise', date: '2000-01-01', command: 'refine-exercise-prep'}),
	);
	const presentations = tree.children.find((child) => child.name === 'Presentation').children;
	presentations.push(
		presentation({name: 'Refine exercise', id: 'exercise-presentation', command: 'refine-exercise-apply'}),
	);

	const plan = computeLlmDag(tree, '2000-01-01');
	assert.equal(plan.prepBranches[0].tasks[0].slug, 'refine-exercise');
	assert.equal(plan.presentation.at(-1).slug, 'refine-exercise');
});

test('computeLlmDag pairs different commands through the shared task name', () => {
	const tree = fixture();
	const prep = tree.children.find((child) => child.name === 'Prep');
	prep.children.unshift(task({name: 'Process inbox', id: 'inbox', date: '2000-01-01', command: 'refine-inbox'}));
	const presentations = tree.children.find((child) => child.name === 'Presentation').children;
	presentations.push(presentation({name: 'Process inbox', id: 'inbox-presentation', command: 'inbox'}));

	const plan = computeLlmDag(tree, '2000-01-01');
	assert.equal(plan.prepBranches[0].tasks[0].slug, 'refine-inbox');
	assert.equal(plan.presentation.at(-1).slug, 'refine-inbox');
});

test('computeLlmDag rejects duplicate inferred slugs', () => {
	const tree = fixture();
	const prep = tree.children.find((child) => child.name === 'Prep');
	prep.children.push(
		task({name: 'Another daily task', id: 'another-daily', date: '2000-01-01', command: 'daily-auto', auto: true}),
	);

	assert.throws(() => computeLlmDag(tree, '2000-01-01'), /Prep has duplicate slug "daily"/);
});

test('computeLlmDag rejects obsolete Key markers', () => {
	const tree = fixture();
	const item = tree.children.find((child) => child.name === 'Prep').children[0];
	item.children.push(instruction('Key: daily'));

	assert.throws(() => computeLlmDag(tree, '2000-01-01'), /obsolete Key marker/);
});
