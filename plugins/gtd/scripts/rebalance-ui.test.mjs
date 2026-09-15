// Run: node --test plugins/gtd/scripts/rebalance-ui.test.mjs
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test test() calls are fire-and-forget by design */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildLadderModel, diffSubmission, renderPage} from './rebalance-ui.mjs';

const bucket = (id, tiers) => ({
	id,
	name: '📌 Tasks (asap) (work)',
	children: tiers.map(([label, items]) => ({
		name: label,
		id: `${id}-${label}`,
		children: items.map((n) => ({id: `${n}-id`, shortId: n, name: n, completedAt: null})),
	})),
});

test('buildLadderModel carries every tier with its 2^k capacity', () => {
	const model = buildLadderModel(
		'work',
		bucket('w', [
			['1st', ['a']],
			['2nd', ['b', 'c']],
		]),
	);
	assert.equal(model.root, 'work');
	assert.equal(model.bucketId, 'w');
	assert.deepStrictEqual(
		model.tiers.map((t) => [t.label, t.capacity, t.items.length]),
		[
			['1st', 2, 1],
			['2nd', 4, 2],
		],
	);
});

test('an empty tier survives into the model rather than being dropped', () => {
	const model = buildLadderModel(
		'work',
		bucket('w', [
			['1st', ['a']],
			['2nd', []],
			['3rd', ['b']],
		]),
	);
	const second = model.tiers.find((t) => t.label === '2nd');
	assert.ok(second, 'the empty 2nd tier must be present');
	assert.deepStrictEqual(second.items, []);
});

test('renderPage emits a single continuous list, not one box per tier', () => {
	const html = renderPage([
		buildLadderModel(
			'work',
			bucket('w', [
				['1st', ['a']],
				['2nd', []],
			]),
		),
	]);
	assert.match(html, /class="ladder-list"/, 'one continuous list container per ladder');
	assert.ok(!/class="tier-box"/.test(html), 'tiers must be dividers inside the list, not separate boxes');
	assert.match(html, /data-tier-boundary="2"/, 'tier boundaries are rendered inside the list');
});

test('every tier band is a drop target with a minimum height, empty ones included', () => {
	const html = renderPage([
		buildLadderModel(
			'work',
			bucket('w', [
				['1st', ['a']],
				['2nd', []],
			]),
		),
	]);
	assert.match(html, /--tier-min-drop-height/, 'a minimum drop-zone height must be defined');
	assert.match(html, /empty — drop here/, 'an empty tier renders explicit empty-state text');
	const span = html.slice(html.indexOf('data-tier-span="2"'));
	assert.match(span.slice(0, 400), /data-drop-target="true"/, 'the empty tier span is still a drop target');
});

test('diffSubmission emits creates for new tiers before the moves into them', () => {
	const model = buildLadderModel(
		'work',
		bucket('w', [
			['1st', ['a']],
			['2nd', ['b', 'c']],
		]),
	);
	const ops = diffSubmission([model], {
		roots: {
			work: {
				bucketId: 'w',
				tiers: [
					{tier: 1, label: '1st', id: 'w-1st', isNew: false, items: ['a-id']},
					{tier: 2, label: '2nd', id: 'w-2nd', isNew: false, items: ['b-id']},
					{tier: 3, label: '3rd', id: null, isNew: true, items: ['c-id']},
				],
			},
		},
	});
	assert.equal(ops[0].op, 'create');
	assert.equal(ops[0].label, '3rd');
	assert.deepStrictEqual(
		ops.slice(1).map((o) => [o.op, o.nodeId, o.toLabel]),
		[['move', 'c-id', '3rd']],
	);
});

test('diffSubmission reports only items that actually changed tier', () => {
	const model = buildLadderModel(
		'work',
		bucket('w', [
			['1st', ['a']],
			['2nd', ['b']],
		]),
	);
	const ops = diffSubmission([model], {
		roots: {
			work: {
				bucketId: 'w',
				tiers: [
					{tier: 1, label: '1st', id: 'w-1st', isNew: false, items: ['a-id']},
					{tier: 2, label: '2nd', id: 'w-2nd', isNew: false, items: ['b-id']},
				],
			},
		},
	});
	assert.deepStrictEqual(ops, []);
});

test('each ladder carries its own tier ids, so two ladders never share a destination', () => {
	const work = buildLadderModel(
		'work',
		bucket('w', [
			['1st', ['a']],
			['2nd', ['b']],
		]),
	);
	const personal = buildLadderModel(
		'personal',
		bucket('p', [
			['1st', ['c']],
			['2nd', ['d']],
		]),
	);
	const html = renderPage([work, personal]);
	assert.match(html, /data-tier-id="w-1st"/, "work's 1st tier id must be in the markup");
	assert.match(html, /data-tier-id="p-1st"/, "personal's 1st tier id must be in the markup");
	const personalSection = html.slice(html.indexOf('data-root="personal"'));
	assert.ok(!personalSection.includes('data-tier-id="w-'), 'the personal ladder must not carry work tier ids');
});

test('rows carry a stable index so a shift-click range can be computed', () => {
	const html = renderPage([
		buildLadderModel(
			'work',
			bucket('w', [
				['1st', ['a', 'b']],
				['2nd', ['c']],
			]),
		),
	]);
	assert.match(html, /data-row-index="0"/, 'rows must be indexed for range selection');
	assert.match(html, /data-row-index="2"/, 'indices run across tier boundaries, not per tier');
});

test('the page selects with click and extends with shift-click, not with checkboxes', () => {
	const html = renderPage([
		buildLadderModel(
			'work',
			bucket('w', [
				['1st', ['a']],
				['2nd', ['b']],
			]),
		),
	]);
	assert.match(html, /shiftKey/, 'shift-click range selection must be wired');
	assert.ok(!/type="checkbox"|type="radio"/.test(html), 'no per-row checkbox or radio circles');
});

test('dragging a selected row carries every selected row as one block', () => {
	const html = renderPage([
		buildLadderModel(
			'work',
			bucket('w', [
				['1st', ['a', 'b']],
				['2nd', []],
			]),
		),
	]);
	assert.match(html, /selectedRows|carrySelection/, 'drag must move the whole selection, not just the grabbed row');
});

test('every mutation autosaves, so there is no Submit button to forget', () => {
	const html = renderPage([
		buildLadderModel(
			'work',
			bucket('w', [
				['1st', ['a']],
				['2nd', []],
			]),
		),
	]);
	assert.match(html, /autosave/i, 'the page must save on each change');
	assert.ok(!/id="submit"/.test(html), 'an explicit Submit button must not gate saving');
});

test('each tier region is painted by capacity state, not just labelled with text', () => {
	const html = renderPage([
		buildLadderModel(
			'w1',
			bucket('w', [
				['1st', ['a']],
				['2nd', ['b', 'c', 'd', 'e', 'f']],
			]),
		),
	]);
	assert.match(html, /--over-bg/, 'an over-cap state colour must be defined');
	assert.match(html, /--room-bg/, 'an under-cap state colour must be defined');
	assert.match(html, /--exact-bg/, 'an at-cap state colour must be defined');
	assert.match(
		html,
		/class="span [a-z]+"|data-state="(room|exact|over)"/,
		'the span itself carries its capacity state',
	);
});

test('an over-cap tier is marked over and an under-cap tier is marked room', () => {
	// 1st holds 1 of 2 (room); 2nd holds 5 of 4 (over)
	const html = renderPage([
		buildLadderModel(
			'w2',
			bucket('w', [
				['1st', ['a']],
				['2nd', ['b', 'c', 'd', 'e', 'f']],
			]),
		),
	]);
	// slice from each tier's BOUNDARY, since data-state precedes data-tier-span on the span
	const first = html.slice(html.indexOf('data-tier-boundary="1"'), html.indexOf('data-tier-boundary="2"'));
	const second = html.slice(html.indexOf('data-tier-boundary="2"'));
	assert.match(first, /data-state="room"/, '1st is under cap');
	assert.match(second, /data-state="over"/, '2nd is over cap');
});

test('a tier with room shows its free slots so the gap is visible, not inferred', () => {
	const html = renderPage([
		buildLadderModel(
			'w3',
			bucket('w', [
				['1st', ['a']],
				['2nd', []],
			]),
		),
	]);
	assert.match(html, /class="slot"/, 'free capacity renders as empty slots');
});

test('rows past the cap are marked so you can see which ones must leave', () => {
	const html = renderPage([
		buildLadderModel(
			'w4',
			bucket('w', [
				['1st', ['a']],
				['2nd', ['b', 'c', 'd', 'e', 'f']],
			]),
		),
	]);
	assert.match(html, /row excess|class="row[^"]*excess/, 'the overflowing rows carry an excess marker');
});

test('a legend explains the three capacity states', () => {
	const html = renderPage([buildLadderModel('w5', bucket('w', [['1st', ['a']]]))]);
	assert.match(html, /class="legend"/, 'the page carries a legend');
});

test('the draft key is bound to the ladder shape, so a stale draft cannot rearrange a new page', () => {
	const sixTiers = buildLadderModel(
		'work',
		bucket('w', [
			['1st', ['a']],
			['2nd', ['b']],
			['3rd', ['c']],
			['4th', ['d']],
			['5th', ['e']],
			['6th', ['f']],
		]),
	);
	const sevenTiers = buildLadderModel(
		'work',
		bucket('w', [
			['1st', ['a']],
			['2nd', ['b']],
			['3rd', ['c']],
			['4th', ['d']],
			['5th', ['e']],
			['6th', ['f']],
			['7th', ['g']],
		]),
	);
	// the key is derived at runtime from PAGE_SIGNATURE, so compare that
	const keyOf = (html) => html.match(/const PAGE_SIGNATURE = "([^"]+)"/)[1];
	const six = keyOf(renderPage([sixTiers]));
	const seven = keyOf(renderPage([sevenTiers]));
	assert.notEqual(six, seven, 'adding a tier must invalidate the previous draft, not silently replay it');
});

test('a draft whose rows no longer match the page is ignored rather than applied', () => {
	const html = renderPage([
		buildLadderModel(
			'work',
			bucket('w', [
				['1st', ['a']],
				['2nd', ['b']],
			]),
		),
	]);
	assert.match(
		html,
		/draftMatchesPage|draft\.signature/,
		'the restore path must validate the draft before applying it',
	);
});

// --- the Queue template is the page we ship; the generator only injects data ---
import {renderFromTemplate, toQueueLadders} from './rebalance-ui.mjs';

test('toQueueLadders emits the shape the Queue template expects', () => {
	const model = buildLadderModel(
		'work',
		bucket('w', [
			['1st', ['a']],
			['2nd', ['b', 'c']],
		]),
	);
	const out = toQueueLadders([model]);
	assert.deepStrictEqual(Object.keys(out), ['work']);
	assert.equal(out.work.bucketId, 'w');
	assert.deepStrictEqual(
		out.work.tiers.map((t) => [t.label, t.id, t.items.length]),
		[
			['1st', 'w-1st', 1],
			['2nd', 'w-2nd', 2],
		],
	);
	// the template reads item.name, not item.text
	assert.ok('name' in out.work.tiers[0].items[0], 'items must carry name');
});

test('renderFromTemplate injects the data and keeps the Queue UI intact', () => {
	const html = renderFromTemplate([buildLadderModel('work', bucket('w', [['1st', ['a']]]))]);
	assert.ok(!html.includes('__LADDERS__'), 'the placeholder must be substituted');
	assert.match(html, /shiftKey/, 'the Queue shift-click behaviour survives');
	assert.match(html, /rootnav/, 'the Queue root tabs survive');
	assert.match(html, /Newsreader/, 'the Queue typography survives');
	assert.match(html, /var LADDERS = \{/, 'data is injected as the LADDERS object');
});

test('injected ladder data is valid JSON the page can parse', () => {
	const html = renderFromTemplate([buildLadderModel('work', bucket('w', [['1st', ['a "quoted" item']]]))]);
	const json = html.match(/var LADDERS = (\{[\s\S]*?\});\n/)[1];
	const parsed = JSON.parse(json);
	assert.equal(parsed.work.tiers[0].items[0].name, 'a "quoted" item');
});

test('the injected payload cannot break out of the script tag', () => {
	const html = renderFromTemplate([buildLadderModel('work', bucket('w', [['1st', ['</script><img src=x>']]]))]);
	assert.ok(!html.includes('</script><img src=x>'), 'a closing script tag in task text must be escaped');
});

import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';

function arrangement(model) {
	return {
		bucketId: model.bucketId,
		tiers: model.tiers.map((tier) => ({
			tier: tier.tier,
			label: tier.label,
			id: tier.id,
			isNew: false,
			items: tier.items.map((item) => item.id),
		})),
	};
}

test('apply rejects stale destinations, missing rows and duplicate rows before emitting proposals', () => {
	const model = buildLadderModel('work', bucket('w', [['1st', ['a', 'b']]]));
	for (const mutate of [
		(root) => {
			root.bucketId = 'other-bucket';
		},
		(root) => {
			root.tiers[0].id = 'other-tier';
		},
		(root) => {
			root.tiers[0].items.pop();
		},
		(root) => {
			root.tiers[0].items[1] = 'a-id';
		},
		(root) => {
			root.tiers[0].items[1] = 'unknown-id';
		},
	]) {
		const root = arrangement(model);
		mutate(root);
		assert.throws(() => diffSubmission([model], {roots: {work: root}}), {name: 'AssertionError'});
	}
});

test('CLI generates a static page and emits creates before moves across both roots', () => {
	const directory = mkdtempSync(join(tmpdir(), 'rebalance-test-'));
	try {
		const work = bucket('w', [['1st', ['a']]]);
		const personal = bucket('p', [['1st', ['b']]]);
		const paths = ['work.json', 'personal.json'].map((file) => join(directory, file));
		writeFileSync(paths[0], JSON.stringify(work));
		writeFileSync(paths[1], JSON.stringify(personal));
		const page = join(directory, 'page.html');
		const script = new URL('./rebalance-ui.mjs', import.meta.url).pathname;
		assert.equal(
			execFileSync(process.execPath, [script, '--html', ...paths, '--output', page], {encoding: 'utf8'}),
			page + '\n',
		);
		const html = readFileSync(page, 'utf8');
		const ladders = JSON.parse(html.match(/var LADDERS = (\{[\s\S]*?\});\n/)[1]);
		const roots = Object.fromEntries(
			Object.entries(ladders).map(([root, ladder]) => [
				root,
				{
					bucketId: ladder.bucketId,
					tiers: [
						{tier: 1, label: '1st', id: ladder.tiers[0].id, isNew: false, items: []},
						{
							tier: 2,
							label: '2nd',
							id: null,
							isNew: true,
							items: ladder.tiers[0].items.map((item) => item.id),
						},
					],
				},
			]),
		);
		const submission = join(directory, 'submission.json');
		writeFileSync(
			submission,
			JSON.stringify({submittedAt: '2000-01-01T00:00:00.000Z', roots, completed: ['b-id']}),
		);
		const actual = JSON.parse(
			execFileSync(process.execPath, [script, '--apply', submission, ...paths], {encoding: 'utf8'}),
		);
		assert.deepStrictEqual(actual, [
			{op: 'create', root: 'work', bucketId: 'w', label: '2nd', tier: 2},
			{op: 'create', root: 'personal', bucketId: 'p', label: '2nd', tier: 2},
			{
				op: 'move',
				root: 'work',
				nodeId: 'a-id',
				text: 'a',
				fromLabel: '1st',
				toLabel: '2nd',
				toId: null,
				toIsNew: true,
			},
			{
				op: 'move',
				root: 'personal',
				nodeId: 'b-id',
				text: 'b',
				fromLabel: '1st',
				toLabel: '2nd',
				toId: null,
				toIsNew: true,
			},
			{op: 'complete', root: 'personal', nodeId: 'b-id'},
		]);
	} finally {
		rmSync(directory, {recursive: true});
	}
});

test('static page persistence offers the same JSON when artifact storage is unavailable', async () => {
	const model = buildLadderModel('work', bucket('w', [['1st', ['a']]]));
	const html = renderFromTemplate([model]);
	const persistence = html.slice(html.indexOf('async function persist()'), html.indexOf('function restoreDraft()'));
	const payload = {submittedAt: '2000-01-01T00:00:00.000Z', roots: {work: arrangement(model)}, completed: []};
	for (const claude of [
		undefined,
		{
			use: async () => {
				throw new Error('offline');
			},
		},
	]) {
		const elements = {fallback: {hidden: true}, 'fallback-json': {value: ''}};
		const context = {
			claude,
			saveTimer: null,
			saving: false,
			dirtyAgain: false,
			collect: () => payload,
			saveState: {},
			document: {getElementById: (id) => elements[id]},
		};
		await runInNewContext(persistence + '\npersist()', context);
		assert.deepStrictEqual(elements, {
			fallback: {hidden: false},
			'fallback-json': {value: JSON.stringify(payload, null, 2)},
		});
	}
});

test('Queue collects and restores a draft with a ninth tier and resets to the source ladder', () => {
	const model = buildLadderModel('work', bucket('w', [['8th', ['a']]]));
	const html = renderFromTemplate([model]);
	const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join('\n');
	const draft = {
		seq: {
			work: [
				{kind: 'sep', label: '8th'},
				{kind: 'sep', label: '9th'},
				{kind: 'item', id: 'a-id', name: 'a', shortId: null},
			],
		},
		done: {},
	};
	const elements = new Map();
	const context = {
		localStorage: {getItem: () => JSON.stringify(draft)},
		document: {
			getElementById: (id) => {
				if (!elements.has(id)) elements.set(id, {addEventListener() {}});
				return elements.get(id);
			},
		},
	};
	const instrumented = script.replace(
		/\n\s*render\(\);\n\s*\}\)\(\);/,
		'\n globalThis.queue = {collect, build};\n})();',
	);
	runInNewContext(instrumented, context);
	const collected = JSON.parse(JSON.stringify(context.queue.collect()));
	delete collected.submittedAt;
	assert.deepStrictEqual(collected, {
		roots: {
			work: {
				bucketId: 'w',
				tiers: [
					{tier: 8, label: '8th', id: 'w-8th', isNew: false, items: []},
					{tier: 9, label: '9th', id: null, isNew: true, items: ['a-id']},
				],
			},
		},
		completed: [],
	});
	context.queue.build();
	const reset = JSON.parse(JSON.stringify(context.queue.collect()));
	delete reset.submittedAt;
	assert.deepStrictEqual(reset, {roots: {work: arrangement(model)}, completed: []});
});

function runQueuePage(html) {
	const nodes = [];
	function element() {
		const node = {
			children: [],
			dataset: {},
			style: {},
			handlers: {},
			className: '',
			setAttribute() {},
			setPointerCapture() {},
			addEventListener(type, handler) {
				this.handlers[type] = handler;
			},
			appendChild(child) {
				this.insertBefore(child, null);
			},
			insertBefore(child, before) {
				if (child.parentNode) child.parentNode.removeChild(child);
				this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, child);
				child.parentNode = this;
			},
			removeChild(child) {
				this.children.splice(this.children.indexOf(child), 1);
				child.parentNode = null;
			},
			get firstChild() {
				return this.children[0];
			},
			get nextSibling() {
				return this.parentNode.children[this.parentNode.children.indexOf(this) + 1];
			},
			set innerHTML(value) {
				this.children = [];
				this.html = value;
			},
			closest(selector) {
				return selector === 'a,button,.grip' ? null : this;
			},
		};
		node.classList = {
			contains: (name) => node.className.split(' ').includes(name),
			add: (name) => {
				node.className += ' ' + name;
			},
			remove: (name) => {
				node.className = node.className
					.split(' ')
					.filter((part) => part !== name)
					.join(' ');
			},
		};
		nodes.push(node);
		return node;
	}
	const elements = new Map();
	let target;
	let pendingSave;
	const writes = [];
	const context = {
		localStorage: {getItem: () => null, setItem() {}},
		setTimeout(callback) {
			pendingSave = callback;
			return 1;
		},
		clearTimeout() {},
		window: {innerHeight: 1000},
		claude: {
			async use() {
				return {
					doc(path) {
						return {
							async set(payload) {
								writes.push({path, payload: JSON.parse(JSON.stringify(payload))});
							},
						};
					},
				};
			},
		},
		document: {
			createElement: element,
			getElementById(id) {
				if (!elements.has(id)) elements.set(id, element());
				return elements.get(id);
			},
			elementFromPoint: () => target,
			querySelector: (selector) =>
				nodes.find((node) =>
					selector
						.slice(1)
						.split('.')
						.every((name) => node.classList.contains(name)),
				),
		},
	};
	const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join('\n');
	runInNewContext(
		script.replace(/\n\s*render\(\);\n\s*\}\)\(\);/, '\nrender(); globalThis.queue = {collect};\n})();'),
		context,
	);
	return {
		elements,
		context,
		writes,
		setTarget: (value) => {
			target = value;
		},
		async flushSave() {
			await pendingSave();
		},
	};
}

test('generated Queue highlights empty tier 6 and accepts a pointer drag from tier 5', () => {
	const model = buildLadderModel(
		'work',
		bucket('w', [
			['5th', ['a']],
			['6th', []],
		]),
	);
	const html = renderFromTemplate([model]);
	assert.match(html, /\.zone\s*\{\s*min-height: 44px;/);
	assert.match(html, /\.zone\.drag-over\s*\{\s*background: var\(--accent-soft\);/);
	const {elements, context, setTarget} = runQueuePage(html);
	const queue = elements.get('app').children[0];
	assert.deepStrictEqual(
		queue.children.map((node) => [node.className, node.dataset.label ?? null]),
		[
			['sep room', null],
			['zone room', '5th'],
			['sep room', null],
			['zone room', '6th'],
		],
	);
	const fifth = queue.children[1];
	const sixth = queue.children[3];
	assert.equal(sixth.firstChild.textContent, 'empty -- drop here');
	const grip = fifth.firstChild.firstChild;
	const event = {button: 0, pointerId: 1, clientX: 100, clientY: 200, preventDefault() {}};
	grip.handlers.pointerdown(event);
	setTarget(fifth);
	grip.handlers.pointermove(event);
	assert.equal(fifth.className, 'zone room drag-over');
	setTarget(sixth);
	grip.handlers.pointermove(event);
	assert.deepStrictEqual([fifth.className, sixth.className], ['zone room', 'zone room drag-over']);
	grip.handlers.pointerup(event);
	const submission = JSON.parse(JSON.stringify(context.queue.collect()));
	delete submission.submittedAt;
	assert.deepStrictEqual(submission, {
		roots: {
			work: {
				bucketId: 'w',
				tiers: [
					{tier: 5, label: '5th', id: 'w-5th', isNew: false, items: []},
					{tier: 6, label: '6th', id: 'w-6th', isNew: false, items: ['a-id']},
				],
			},
		},
		completed: [],
	});
	assert.equal(elements.get('app').children[0].children[1].firstChild.textContent, 'empty -- drop here');
});

test('generated Queue keeps the range anchor and autosaves ordered group drag, nudge, and Done', async () => {
	const model = buildLadderModel(
		'work',
		bucket('w', [
			['1st', ['a', 'b']],
			['2nd', ['c', 'd']],
			['3rd', ['e']],
		]),
	);
	const page = runQueuePage(renderFromTemplate([model]));
	const rows = () =>
		page.elements
			.get('app')
			.children[0].children.flatMap((zone) => zone.children)
			.filter((row) => row.dataset.id);
	const row = (id) => rows().find((row) => row.dataset.id === id + '-id');
	const click = (id, modifiers = {}) => row(id).handlers.click({target: row(id), ...modifiers});
	const selection = () =>
		rows()
			.filter((row) => row.classList.contains('sel'))
			.map((row) => row.dataset.id);
	click('c');
	click('c');
	assert.deepStrictEqual(selection(), ['c-id']);
	click('a', {shiftKey: true});
	assert.deepStrictEqual(selection(), ['a-id', 'b-id', 'c-id']);
	click('c', {shiftKey: true});
	assert.deepStrictEqual(selection(), ['c-id']);
	click('a', {shiftKey: true});
	const grip = row('b').firstChild;
	const event = {button: 0, pointerId: 1, clientX: 100, clientY: 200, preventDefault() {}, stopPropagation() {}};
	grip.handlers.pointerdown(event);
	page.setTarget(page.elements.get('app').children[0].children.find((zone) => zone.dataset.label === '3rd'));
	grip.handlers.pointerup(event);
	await page.flushSave();
	const saved = () => {
		const write = page.writes.at(-1);
		delete write.payload.submittedAt;
		return write;
	};
	const expected = {
		path: 'rebalance/submission',
		payload: {
			roots: {
				work: {
					bucketId: 'w',
					tiers: [
						{tier: 1, label: '1st', id: 'w-1st', isNew: false, items: []},
						{tier: 2, label: '2nd', id: 'w-2nd', isNew: false, items: ['d-id']},
						{tier: 3, label: '3rd', id: 'w-3rd', isNew: false, items: ['e-id', 'a-id', 'b-id', 'c-id']},
					],
				},
			},
			completed: [],
		},
	};
	assert.deepStrictEqual(saved(), expected);
	row('d').children[3].children[1].handlers.click(event);
	await page.flushSave();
	expected.payload.roots.work.tiers[1].items = [];
	expected.payload.roots.work.tiers[2].items = ['d-id', 'e-id', 'a-id', 'b-id', 'c-id'];
	assert.deepStrictEqual(saved(), expected);
	row('d').children[4].handlers.click(event);
	await page.flushSave();
	expected.payload.completed = ['d-id'];
	assert.deepStrictEqual(saved(), expected);
	assert.equal(page.writes.length, 3);
});

test('CLI defaults to the local web app without exporting task data', () => {
	const script = new URL('./rebalance-ui.mjs', import.meta.url).pathname;
	assert.equal(
		execFileSync(process.execPath, [script], {
			encoding: 'utf8',
			env: {...process.env, REBALANCE_WEB_APP_URL: 'http://localhost:5175'},
		}),
		'http://localhost:5175/ladder\n',
	);
});
