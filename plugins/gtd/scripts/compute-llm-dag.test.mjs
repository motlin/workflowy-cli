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

const task = ({name, id, date, key, interval, auto = false}) => ({
	name: `${name} ${time(date, 'Sat, Jan 1, 2000')}`,
	id,
	shortId: `${id}-short`,
	completedAt: null,
	children: [
		instruction(`/gtd:${key}-prep`),
		instruction(`Key: ${key}`),
		...(interval ? [instruction(`Interval: ${interval}`)] : []),
		...(auto ? [instruction('Auto')] : []),
	],
});

const presentation = ({name, id, key}) => ({
	name,
	id,
	shortId: `${id}-short`,
	completedAt: null,
	children: [instruction(`/gtd:${key}-apply`), instruction(`Key: ${key}`)],
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
				task({name: 'Daily task', id: 'daily', date: '2000-01-01', key: 'daily'}),
				{
					name: 'Serial: calendar',
					id: 'serial',
					children: [
						task({name: 'Weekly task', id: 'weekly', date: '1999-12-31', key: 'weekly', interval: '7d'}),
					],
				},
				task({name: 'Future auto task', id: 'future', date: '2000-01-02', key: 'future', auto: true}),
			],
		},
		{
			name: 'Presentation',
			id: 'presentation',
			children: [
				presentation({name: 'Weekly task', id: 'weekly-presentation', key: 'weekly'}),
				presentation({name: 'Daily task', id: 'daily-presentation', key: 'daily'}),
			],
		},
	],
});

test('computeLlmDag inherits due state from prep and preserves presentation order', () => {
	const plan = computeLlmDag(fixture(), '2000-01-01');

	assert.deepEqual(
		plan.prepBranches.map((branch) => ({mode: branch.mode, keys: branch.tasks.map((item) => item.key)})),
		[
			{mode: 'parallel', keys: ['daily']},
			{mode: 'serial', keys: ['weekly']},
		],
	);
	assert.deepEqual(
		plan.presentation.map((item) => item.key),
		['weekly', 'daily'],
	);
	assert.deepEqual(plan.skipped, [{key: 'future', reason: 'future', dueDate: '2000-01-02'}]);
});

test('computeLlmDag defaults to daily and honors explicit weekly intervals', () => {
	const plan = computeLlmDag(fixture(), '2000-01-01');
	const tasks = plan.prepBranches.flatMap((branch) => branch.tasks);
	const daily = tasks.find((item) => item.key === 'daily');
	const weekly = tasks.find((item) => item.key === 'weekly');

	assert.deepEqual(daily.interval, {amount: 1, unit: 'd'});
	assert.equal(daily.advance.nextDate, '2000-01-02');
	assert.deepEqual(weekly.interval, {amount: 7, unit: 'd'});
	assert.equal(weekly.advance.nextDate, '2000-01-08');
	assert.match(weekly.advance.applyOp, /--id weekly/);
	assert.match(weekly.advance.applyOp, /--expect-name/);
});

test('computeLlmDag rejects unexpected root children', () => {
	const tree = fixture();
	tree.children.push(task({name: 'Orphan', id: 'orphan', date: '2000-01-01', key: 'orphan'}));

	assert.throws(() => computeLlmDag(tree, '2000-01-01'), /unexpected child "Orphan/);
});

test('computeLlmDag rejects unmatched keys', () => {
	const tree = fixture();
	tree.children.find((child) => child.name === 'Presentation').children.pop();

	assert.throws(() => computeLlmDag(tree, '2000-01-01'), /prep key "daily" has no presentation task/);
});

test('computeLlmDag rejects dates on presentation tasks', () => {
	const tree = fixture();
	const item = tree.children.find((child) => child.name === 'Presentation').children[0];
	item.name += ` ${time('2000-01-01', 'Sat, Jan 1, 2000')}`;

	assert.throws(() => computeLlmDag(tree, '2000-01-01'), /presentation key "weekly" must inherit its date/);
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
		.children.push(presentation({name: 'Future auto task', id: 'future-presentation', key: 'future'}));

	assert.throws(() => computeLlmDag(tree, '2000-01-01'), /auto prep key "future" must not have a presentation task/);
});
