#!/usr/bin/env node
// Validate a staged daily-review proposal file against the contract in
// plugins/gtd/skills/review-proposal-staging.md.
//
// Usage: node plugins/gtd/scripts/validate-proposal.mjs .llm/gtd/review/proposals/<slug>.json

import {readFileSync} from "node:fs";

const REQUIRED_TOP_LEVEL = ["task", "generatedAt", "status"];
const KNOWN_STATUSES = ["ready", "needs-interactive", "empty", "error"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A proposal stages exactly one node id: `nodeId`, the node its applyOps mutate. Every other id
// belongs inside an applyOps command string, already bound to its flag. A second bare id field is
// the bug this guards: a consumer reads it as a write target and moves the item under the wrong
// parent. Inert fields (counts, labels, fingerprints) are free to vary per task.
const ID_FIELD = /(?:^|[a-z])(?:Id|ID)$/;
const DEFAULT_ID_HINT = "a proposal carries only nodeId; put every other id inside an applyOps command";
const ID_HINTS = {
	moveToNodeId:
		"the 📍 Move to: suggestion child is not a destination parent; resolve destinations by path at apply time",
};

const strayIdError = (index, field) =>
	`proposals[${index}]: stages a second node id "${field}" — ${ID_HINTS[field] ?? DEFAULT_ID_HINT}`;

// email-calendar apply appends each decision to .llm/gtd/review/email-calendar-decisions.json under
// `key`, and the next prep drops candidates whose key is already there. A proposal staged without
// that field writes a null-keyed ledger row that suppresses nothing, so the same email is
// re-proposed every run with no visible error. Prep once staged the identity as `sourceKey`, which
// is the mismatch this names.
const LEDGER_KEY_TASKS = new Set(["email-calendar"]);
const LEDGER_KEY_ALIASES = ["sourceKey"];

const isNonBlank = (value) => typeof value === "string" && value.trim() !== "";

const validateLedgerKey = (task, entry, index, errors) => {
	if (!LEDGER_KEY_TASKS.has(task)) {
		return;
	}
	if (isNonBlank(entry.key)) {
		return;
	}
	const alias = LEDGER_KEY_ALIASES.find((field) => entry[field] !== undefined);
	if (alias) {
		errors.push(
			`proposals[${index}]: ${task} proposal stages its ledger key as "${alias}" — the ledger and apply read "key"; rename it`,
		);
		return;
	}
	errors.push(
		`proposals[${index}]: ${task} proposal has no ledger "key" — apply writes it to ${task}-decisions.json, and a null key never suppresses a re-proposal`,
	);
};

// "Reject and delete" trashes the source email through the Gmail IMAP MCP, so apply needs the
// exact message coordinates from prep rather than re-searching the inbox for it.
const SOURCE_MESSAGE_FIELDS = {
	account: isNonBlank,
	mailbox: isNonBlank,
	messageUid: (value) => Number.isInteger(value) && value > 0,
};

const validateSourceMessage = (task, entry, index, errors) => {
	if (!LEDGER_KEY_TASKS.has(task)) {
		return;
	}
	const missing = Object.entries(SOURCE_MESSAGE_FIELDS)
		.filter(([field, isValid]) => !isValid(entry[field]))
		.map(([field]) => field);
	if (missing.length > 0) {
		errors.push(
			`proposals[${index}]: ${task} proposal is missing source message field(s) ${missing.join(", ")} — apply needs them to trash the email on "Reject and delete"`,
		);
	}
};

// Apply links each question to the source email (a Gmail rfc822msgid search URL) and to the
// sign-up/RSVP links in its body, so the user can act without hunting for the message.
// messageId is an RFC 822 Message-ID, not a Workflowy node id, so it is exempt from the stray-id check.
const NON_NODE_ID_FIELDS = {"email-calendar": new Set(["messageId"])};
const isHttpUrl = (value) => typeof value === "string" && /^https?:\/\/\S+$/.test(value);

const validateSourceLinks = (task, entry, index, errors) => {
	if (!LEDGER_KEY_TASKS.has(task)) {
		return;
	}
	if (!isNonBlank(entry.messageId)) {
		errors.push(
			`proposals[${index}]: ${task} proposal is missing "messageId" (RFC 822 Message-ID) — apply builds the Gmail link to the source email from it`,
		);
	}
	if (!Array.isArray(entry.actionLinks) || !entry.actionLinks.every(isHttpUrl)) {
		errors.push(
			`proposals[${index}]: ${task} proposal needs "actionLinks" as an array of http(s) URLs (empty when the email has none)`,
		);
	}
};

const validateProposalEntry = (task, entry, index, errors) => {
	validateLedgerKey(task, entry, index, errors);
	validateSourceMessage(task, entry, index, errors);
	validateSourceLinks(task, entry, index, errors);

	const exemptIdFields = NON_NODE_ID_FIELDS[task] ?? new Set();
	for (const field of Object.keys(entry)) {
		if (field !== "nodeId" && !exemptIdFields.has(field) && ID_FIELD.test(field)) {
			errors.push(strayIdError(index, field));
			return;
		}
	}

	if (typeof entry.nodeId === "string" && !UUID.test(entry.nodeId)) {
		errors.push(`proposals[${index}]: nodeId "${entry.nodeId}" is not a full uuid`);
		return;
	}

	const ops = Array.isArray(entry.applyOps) ? entry.applyOps : [];
	for (const [opIndex, op] of ops.entries()) {
		if (op.includes("--name") && !op.includes("--expect-name")) {
			errors.push(`proposals[${index}]: applyOps[${opIndex}] updates --name without --expect-name`);
			return;
		}
	}
};

export const validateProposal = (staged) => {
	const errors = [];

	for (const field of REQUIRED_TOP_LEVEL) {
		if (staged[field] === undefined) {
			errors.push(`missing required field "${field}"`);
		}
	}

	if (staged.status !== undefined && !KNOWN_STATUSES.includes(staged.status)) {
		errors.push(`unknown status "${staged.status}"`);
		return {valid: false, errors};
	}

	const proposals = Array.isArray(staged.proposals) ? staged.proposals : [];
	if (staged.status !== "ready" && proposals.length > 0) {
		errors.push(`status "${staged.status}" must carry an empty proposals[] array`);
		return {valid: false, errors};
	}

	for (const [index, entry] of proposals.entries()) {
		validateProposalEntry(staged.task, entry, index, errors);
	}

	return {valid: errors.length === 0, errors};
};

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
	const path = process.argv[2];
	if (!path) {
		console.error("usage: validate-proposal.mjs <staged-proposal.json>");
		process.exit(2);
	}

	const {valid, errors} = validateProposal(JSON.parse(readFileSync(path, "utf8")));
	if (valid) {
		console.log(`✓ ${path} matches the staging contract`);
	} else {
		console.error(`✗ ${path} violates the staging contract:`);
		for (const error of errors) {
			console.error(`  - ${error}`);
		}
		process.exit(1);
	}
}
