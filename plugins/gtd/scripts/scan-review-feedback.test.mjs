// Run: node --test plugins/gtd/scripts/scan-review-feedback.test.mjs
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test test() calls are fire-and-forget by design */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
	assistantSummary,
	extractFeedback,
	hasCommandInvocation,
	isHumanUserMessage,
	userText,
} from './scan-review-feedback.mjs';

const humanTyped = {
	type: 'user',
	timestamp: '2026-06-23T22:15:18.000Z',
	message: {role: 'user', content: "you didn't complete the reminders"},
};

const humanTypedBlockArray = {
	type: 'user',
	timestamp: '2026-06-23T22:16:00.000Z',
	message: {role: 'user', content: [{type: 'text', text: 'we ALWAYS work on the skill first'}]},
};

const toolResultEcho = {
	type: 'user',
	timestamp: '2026-06-23T22:15:20.000Z',
	message: {role: 'user', content: [{type: 'tool_result', tool_use_id: 'x', content: 'big tool output'}]},
};

const commandStub = {
	type: 'user',
	timestamp: '2026-06-23T22:00:00.000Z',
	message: {role: 'user', content: '<command-name>/gtd:review:daily</command-name>'},
};

const assistantToolUse = {
	type: 'assistant',
	timestamp: '2026-06-23T22:15:10.000Z',
	message: {
		role: 'assistant',
		content: [
			{type: 'text', text: 'Marking the reminders complete now.'},
			{type: 'tool_use', name: 'Bash', input: {command: 'osascript -e ...'}},
		],
	},
};

test('hasCommandInvocation matches only the requested command stub', () => {
	assert.deepStrictEqual(
		[
			'<command-name>/gtd:review:daily</command-name>',
			'available skill: gtd:review:daily performs the morning review',
			'<command-name>/gtd:review:daily:overview</command-name>',
		].map((raw) => hasCommandInvocation(raw, 'gtd:review:daily')),
		[true, false, false],
	);
});

test('isHumanUserMessage accepts typed text (string and text-block array)', () => {
	assert.equal(isHumanUserMessage(humanTyped), true);
	assert.equal(isHumanUserMessage(humanTypedBlockArray), true);
});

test('isHumanUserMessage rejects tool-result echoes and slash-command stubs', () => {
	assert.equal(isHumanUserMessage(toolResultEcho), false);
	assert.equal(isHumanUserMessage(commandStub), false);
	assert.equal(isHumanUserMessage(assistantToolUse), false);
});

test('isHumanUserMessage rejects harness-injected and synthetic user lines', () => {
	// isMeta marks command-body / skill-injection expansions, not human input.
	assert.equal(
		isHumanUserMessage({
			type: 'user',
			isMeta: true,
			message: {role: 'user', content: [{type: 'text', text: '# Daily Review\n\nRun the full review'}]},
		}),
		false,
	);
	// Sidechain = subagent transcript, not the user.
	assert.equal(
		isHumanUserMessage({
			type: 'user',
			isSidechain: true,
			message: {role: 'user', content: 'hello from a subagent'},
		}),
		false,
	);
	// A user line carrying toolUseResult is a tool echo even if shaped oddly.
	assert.equal(
		isHumanUserMessage({type: 'user', toolUseResult: {}, message: {role: 'user', content: 'output'}}),
		false,
	);
	// The interrupt marker is synthetic.
	assert.equal(
		isHumanUserMessage({
			type: 'user',
			message: {role: 'user', content: [{type: 'text', text: '[Request interrupted by user for tool use]'}]},
		}),
		false,
	);
});

test('userText pulls a clean string from either content shape', () => {
	assert.equal(userText(humanTyped), "you didn't complete the reminders");
	assert.equal(userText(humanTypedBlockArray), 'we ALWAYS work on the skill first');
});

test('assistantSummary names the tools/commands the assistant just ran', () => {
	const s = assistantSummary(assistantToolUse);
	assert.match(s, /Bash/);
	assert.match(s, /osascript/);
});

test('extractFeedback returns human turns with the preceding assistant action, in order', () => {
	const objs = [commandStub, assistantToolUse, humanTyped, toolResultEcho, humanTypedBlockArray];
	const {turns} = extractFeedback(objs);
	assert.equal(turns.length, 2);
	assert.equal(turns[0].text, "you didn't complete the reminders");
	assert.match(turns[0].prevAssistant, /Bash/);
	assert.equal(turns[1].text, 'we ALWAYS work on the skill first');
	assert.equal(turns[0].ts, '2026-06-23T22:15:18.000Z');
});

test('extractFeedback caps very long turn text so the extract stays compact', () => {
	const long = {
		type: 'user',
		timestamp: '2026-06-23T23:00:00.000Z',
		message: {role: 'user', content: 'x'.repeat(5000)},
	};
	const {turns} = extractFeedback([long]);
	assert.ok(turns[0].text.length <= 2050);
	assert.match(turns[0].text, /…$/);
});
