#!/usr/bin/env node
// Scan Claude Code transcripts for user feedback during daily-review runs.
//
// The daily review's meta-feedback LLM-task uses this to mine the prior run(s)
// for corrections and preferences worth folding back into the skills. Transcript
// JSONL files are huge, so this script does the heavy filtering and emits a
// compact extract — only the human-typed turns and a one-line summary of the
// assistant action each one was reacting to — keeping the giant tool I/O out of
// the prep subagent's context.
//
// Usage:
//   node scan-review-feedback.mjs [--since YYYY-MM-DD|ISO] [--dir <transcripts>] [--marker <text>]
//
// Defaults: --since = 1 day ago, --dir = the workflowy project transcript dir,
// --marker = "gtd:review:daily" (only sessions that ran the daily review).
// Emits JSON: [{sessionId, file, startTs, turns: [{ts, text, prevAssistant}]}].

import {readdirSync, readFileSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const MAX_TEXT = 2000;
const DEFAULT_DIR = join(homedir(), '.claude/projects/-Users-craig-projects-workflowy');

function contentBlocks(obj) {
	const c = obj?.message?.content;
	if (typeof c === 'string') return [{type: 'text', text: c}];
	if (Array.isArray(c)) return c;
	return [];
}

export function isHumanUserMessage(obj) {
	if (obj?.type !== 'user') return false;
	// Harness-injected (command-body / skill expansions), subagent sidechains, and
	// tool-result echoes are not human input even though they share type "user".
	if (obj.isMeta === true || obj.isSidechain === true) return false;
	if (obj.toolUseResult !== undefined) return false;
	const blocks = contentBlocks(obj);
	if (blocks.length === 0) return false;
	if (blocks.some((b) => b?.type === 'tool_result')) return false;
	if (!blocks.some((b) => b?.type === 'text' && typeof b.text === 'string')) return false;
	const text = blocks
		.filter((b) => b?.type === 'text')
		.map((b) => b.text)
		.join('\n')
		.trim();
	if (!text) return false;
	// Slash-command stubs, local command echoes, and the interrupt marker are metadata.
	if (/^<command-(name|message|args)/.test(text)) return false;
	if (text.startsWith('<local-command-stdout>')) return false;
	if (text.startsWith('[Request interrupted')) return false;
	return true;
}

export function userText(obj) {
	const text = contentBlocks(obj)
		.filter((b) => b?.type === 'text' && typeof b.text === 'string')
		.map((b) => b.text)
		.join('\n')
		.trim();
	return text || null;
}

const ASK_PREFIXES = ['The user answered:', 'Your questions have been answered:'];

function toolResultText(obj) {
	if (obj?.type !== 'user') return null;
	const block = contentBlocks(obj).find((b) => b?.type === 'tool_result');
	if (!block) return null;
	const content = block.content ?? block.text;
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.filter((b) => b?.type === 'text' && typeof b.text === 'string')
			.map((b) => b.text)
			.join('\n');
	}
	return null;
}

// AskUserQuestion answers reach the transcript as tool_result blocks, so
// isHumanUserMessage rejects them — yet they carry real user decisions,
// including free-text typed into "Other". Match on the leading prefix only:
// tool output that merely quotes the phrase mid-stream is not an answer.
export function isAskUserQuestionAnswer(obj) {
	const text = toolResultText(obj);
	if (typeof text !== 'string') return false;
	const trimmed = text.trimStart();
	return ASK_PREFIXES.some((p) => trimmed.startsWith(p));
}

export function askAnswerText(obj) {
	if (!isAskUserQuestionAnswer(obj)) return null;
	const text = toolResultText(obj).trim();
	return text || null;
}

export function assistantSummary(obj) {
	if (obj?.type !== 'assistant') return '';
	const blocks = contentBlocks(obj);
	const parts = [];
	for (const b of blocks) {
		if (b?.type === 'tool_use') {
			const cmd = b.input?.command ?? b.input?.description ?? b.input?.prompt ?? '';
			parts.push(`${b.name}${cmd ? `(${String(cmd).slice(0, 80)})` : ''}`);
		}
	}
	if (parts.length) return `ran ${parts.join(', ')}`;
	const text = blocks
		.filter((b) => b?.type === 'text')
		.map((b) => b.text)
		.join(' ')
		.trim();
	return text ? `said "${text.slice(0, 120)}"` : '';
}

export function hasCommandInvocation(raw, marker) {
	return raw.includes(`<command-name>/${marker}</command-name>`);
}

function cap(text) {
	return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '…' : text;
}

export function extractFeedback(objs, {cutoff = null} = {}) {
	// Filter individual turns by timestamp rather than dropping whole sessions:
	// a session opened days before the window still accumulates new feedback.
	// Undated turns are kept — a missing timestamp is not evidence of staleness.
	const withinWindow = (ts) => cutoff === null || !ts || Date.parse(ts) >= cutoff;
	const turns = [];
	let lastAssistant = '';
	for (const obj of objs) {
		if (obj?.type === 'assistant') {
			const s = assistantSummary(obj);
			if (s) lastAssistant = s;
			continue;
		}
		const ts = obj?.timestamp ?? null;
		if (!withinWindow(ts)) continue;
		if (isHumanUserMessage(obj)) {
			turns.push({ts, source: 'typed', text: cap(userText(obj)), prevAssistant: lastAssistant});
		} else if (isAskUserQuestionAnswer(obj)) {
			turns.push({ts, source: 'ask', text: cap(askAnswerText(obj)), prevAssistant: lastAssistant});
		}
	}
	return {turns};
}

function parseLines(raw) {
	const objs = [];
	for (const line of raw.split('\n')) {
		const t = line.trim();
		if (!t) continue;
		try {
			objs.push(JSON.parse(t));
		} catch {
			// Skip malformed lines rather than aborting the whole scan.
		}
	}
	return objs;
}

function sinceMillis(since) {
	// Accept YYYY-MM-DD or full ISO; default to 24h ago.
	if (!since) return Date.now() - 86_400_000;
	const ms = Date.parse(since.length === 10 ? since + 'T00:00:00' : since);
	return Number.isNaN(ms) ? Date.now() - 86_400_000 : ms;
}

function main(argv) {
	const args = argv.slice(2);
	let since = null;
	let dir = DEFAULT_DIR;
	let marker = 'gtd:review:daily';
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--since') since = args[++i];
		else if (args[i] === '--dir') dir = args[++i];
		else if (args[i] === '--marker') marker = args[++i];
	}
	const cutoff = sinceMillis(since);

	const sessions = [];
	for (const name of readdirSync(dir)) {
		if (!name.endsWith('.jsonl')) continue;
		const path = join(dir, name);
		if (statSync(path).mtimeMs < cutoff) continue;
		const raw = readFileSync(path, 'utf8');
		if (!hasCommandInvocation(raw, marker)) continue;
		const objs = parseLines(raw);
		const startTs = objs.find((o) => o.timestamp)?.timestamp ?? null;
		const {turns} = extractFeedback(objs, {cutoff});
		if (turns.length === 0) continue;
		sessions.push({sessionId: objs[0]?.sessionId ?? name.replace('.jsonl', ''), file: path, startTs, turns});
	}
	sessions.sort((a, b) => String(a.startTs).localeCompare(String(b.startTs)));
	process.stdout.write(JSON.stringify(sessions, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
