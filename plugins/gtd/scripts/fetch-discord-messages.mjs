// Read new messages from one Discord channel through a read-only bot, for the capture discord-scanner.
//
// The bot token comes from DISCORD_BOT_TOKEN (gitignored .envrc), never from this plugin. The channel,
// its guild, and the cursor live in Workflowy under Metadata > ⚙️ Scanner State > discord-scanner.
//
//   node fetch-discord-messages.mjs --channel <id> --guild <id> (--after <messageId> | --since-days <n>)
//     -> {channelId, guildId, afterId, newestId, truncated, messages: [scan record, oldest first]}
//
// Exit codes: 0 success, 2 missing token or arguments, 1 Discord API failure (message on stderr).

import {pathToFileURL} from "node:url";

const API = "https://discord.com/api/v10";
const DISCORD_EPOCH = 1420070400000n;
const PAGE_SIZE = 100;

export function snowflakeFromTime(ms) {
	return ((BigInt(ms) - DISCORD_EPOCH) << 22n).toString();
}

export function snowflakeToIso(id) {
	return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH)).toISOString();
}

export function maxSnowflake(ids) {
	return ids.reduce((max, id) => (max === null || BigInt(id) > BigInt(max) ? id : max), null);
}

const byId = (a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchMessagesSince({
	channelId,
	afterId,
	token,
	fetchImpl = fetch,
	sleep = defaultSleep,
	maxPages = 10,
}) {
	const messages = [];
	let cursor = afterId;
	for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
		const url = `${API}/channels/${channelId}/messages?limit=${PAGE_SIZE}&after=${cursor}`;
		const response = await fetchImpl(url, {headers: {Authorization: `Bot ${token}`}});
		if (response.status === 429) {
			const {retry_after: retryAfter} = await response.json();
			await sleep(Math.ceil(retryAfter * 1000));
			pageIndex--;
			continue;
		}
		const body = await response.json();
		if (!response.ok) {
			throw new Error(
				`Discord API ${response.status} for channel ${channelId}: ${body.message} (code ${body.code})`,
			);
		}
		const sorted = [...body].sort(byId);
		messages.push(...sorted);
		if (sorted.length < PAGE_SIZE) break;
		cursor = sorted.at(-1).id;
	}
	return messages;
}

export function toScanRecord(message, guildId) {
	return {
		id: message.id,
		timestamp: message.timestamp,
		author: message.author.global_name ?? message.author.username,
		authorUsername: message.author.username,
		isBot: message.author.bot === true,
		content: message.content,
		attachments: (message.attachments ?? []).map(({filename, url}) => ({filename, url})),
		replyToId: message.message_reference?.message_id ?? null,
		threadName: message.thread?.name ?? null,
		url: `https://discord.com/channels/${guildId}/${message.channel_id}/${message.id}`,
	};
}

function parseArgs(argv) {
	const args = {};
	for (let index = 0; index < argv.length; index += 2) {
		args[argv[index].replace(/^--/, "")] = argv[index + 1];
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const token = process.env.DISCORD_BOT_TOKEN;
	if (!token) {
		console.error("DISCORD_BOT_TOKEN is not set");
		process.exit(2);
	}
	if (!args.channel || !args.guild || (!args.after && !args["since-days"])) {
		console.error(
			"usage: fetch-discord-messages.mjs --channel <id> --guild <id> (--after <id> | --since-days <n>)",
		);
		process.exit(2);
	}
	const afterId = args.after ?? snowflakeFromTime(Date.now() - Number(args["since-days"]) * 86_400_000);
	const maxPages = 10;
	try {
		const raw = await fetchMessagesSince({channelId: args.channel, afterId, token, maxPages});
		const messages = raw.map((message) => toScanRecord(message, args.guild));
		const result = {
			channelId: args.channel,
			guildId: args.guild,
			afterId,
			newestId: maxSnowflake(messages.map((message) => message.id)) ?? afterId,
			truncated: raw.length >= maxPages * PAGE_SIZE,
			messages,
		};
		console.log(JSON.stringify(result, null, 2));
	} catch (error) {
		console.error(error.message);
		process.exit(1);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
