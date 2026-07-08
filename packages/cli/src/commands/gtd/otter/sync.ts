import {Command, Flags} from '@oclif/core';
import {execSync} from 'node:child_process';
import fs from 'node:fs';

const API_BASE = 'https://otter.ai/forward/api/v1';
const COOKIE_FILE = '/tmp/otter-session-cache';
const USERID_FILE = '/tmp/otter-userid-cache';
const CREDS_FILE = '/tmp/otter-creds-cache';

interface OtterSpeech {
	otid: string;
	title: string;
	start_time: number;
	short_abstract_summary?: string;
	action_item_count?: number;
	speech_outline?: Array<{
		text: string;
		segments?: Array<{text: string}>;
	}>;
}

interface ActionItem {
	text: string;
	assignee: string | null;
	completed: boolean;
}

interface ProcessedSpeech {
	otid: string;
	title: string;
	start_time: number;
	summary: string | null;
	action_item_count: number | null;
	outline: Array<{
		title: string;
		segments: string[];
	}>;
	action_items?: ActionItem[];
}

interface SyncOutput {
	last_load_ts: string;
	end_of_list: boolean;
	speeches: ProcessedSpeech[];
}

/**
 * Sync Otter meetings with action items.
 *
 * Fetches meetings and their action items in parallel (when native fetch is available)
 * or sequentially, returning a minimal JSON structure suitable for import.
 */
export default class Sync extends Command {
	static override description = 'Sync Otter meetings with action items';

	static override examples = [
		'# Sync recent meetings',
		'<%= config.bin %> <%= command.id %>',
		'',
		'# Sync with pagination',
		'<%= config.bin %> <%= command.id %> --page-size 100',
	];

	static override flags = {
		'page-size': Flags.integer({
			description: 'Number of results per page',
			default: 50,
		}),
		cursor: Flags.string({
			description: 'Pagination cursor (last_load_ts)',
		}),
		'modified-after': Flags.string({
			description: 'Only fetch items modified after this timestamp',
		}),
		concurrency: Flags.integer({
			description: 'Max concurrent action item requests',
			default: 10,
		}),
	};

	private verbose = process.env.OTTER_VERBOSE === '1';
	private startTime = Date.now();

	public async run(): Promise<SyncOutput> {
		const {flags} = await this.parse(Sync);

		// When paginating with cursor, modified_after is required by API
		let modifiedAfter = flags['modified-after'];
		if (flags.cursor && !modifiedAfter) {
			modifiedAfter = '1';
		}

		this.logTiming(
			`sync: starting page_size=${flags['page-size']} cursor=${flags.cursor} modified_after=${modifiedAfter}`,
		);

		await this.login();

		// Fetch available speeches
		const rawResponse = await this.fetchAvailableSpeeches(flags['page-size'], flags.cursor, modifiedAfter);

		// Extract pagination info and minimal meeting data
		const speeches: ProcessedSpeech[] = [];
		for (const speech of rawResponse.speeches || []) {
			const outline: Array<{title: string; segments: string[]}> = [];
			for (const item of speech.speech_outline || []) {
				outline.push({
					title: item.text,
					segments: (item.segments || []).map((s) => s.text),
				});
			}

			speeches.push({
				otid: speech.otid,
				title: speech.title,
				start_time: speech.start_time,
				summary: speech.short_abstract_summary ?? null,
				action_item_count: speech.action_item_count ?? null,
				outline,
			});
		}

		// Find meetings that need action items (have summary)
		const meetingsNeedingActions = speeches.filter((s) => s.summary !== null);

		if (meetingsNeedingActions.length > 0) {
			this.logTiming(`sync: fetching action items for ${meetingsNeedingActions.length} meetings`);

			// Fetch action items (sequentially for simplicity - could be parallelized)
			const actionMap = new Map<string, ActionItem[]>();

			for (const meeting of meetingsNeedingActions) {
				const items = await this.fetchActionItems(meeting.otid);
				actionMap.set(meeting.otid, items);
			}

			// Merge action items into result
			for (const speech of speeches) {
				speech.action_items = actionMap.get(speech.otid) || [];
			}
		}

		const result: SyncOutput = {
			last_load_ts: rawResponse.last_load_ts,
			end_of_list: rawResponse.end_of_list,
			speeches,
		};

		this.logTiming('sync: done');
		this.log(JSON.stringify(result, null, 2));
		return result;
	}

	private logTiming(msg: string): void {
		if (this.verbose) {
			const elapsed = Date.now() - this.startTime;
			console.error(`[${elapsed}ms] ${msg}`);
		}
	}

	private cookieValid(): boolean {
		if (!fs.existsSync(COOKIE_FILE)) {
			return false;
		}
		const stats = fs.statSync(COOKIE_FILE);
		const age = (Date.now() - stats.mtimeMs) / 1000;
		return age < 3600;
	}

	private async login(): Promise<void> {
		this.logTiming('login: start');

		if (this.cookieValid() && fs.existsSync(USERID_FILE)) {
			this.logTiming('login: using cached session');
			return;
		}

		let username = process.env.OTTER_USERNAME ?? '';
		let password = process.env.OTTER_PASSWORD ?? '';

		if (username.startsWith('op://')) {
			if (fs.existsSync(CREDS_FILE)) {
				this.logTiming('login: using cached credentials');
				const lines = fs.readFileSync(CREDS_FILE, 'utf8').trim().split('\n');
				username = lines[0];
				password = lines[1];
			} else {
				this.logTiming('login: resolving op:// credentials');
				const origUsername = username;
				const origPassword = password;
				username = execSync(`op read "${origUsername}"`, {encoding: 'utf8'}).trim();
				this.logTiming('login: got username');
				password = execSync(`op read "${origPassword}"`, {encoding: 'utf8'}).trim();
				this.logTiming('login: got password');
				fs.writeFileSync(CREDS_FILE, `${username}\n${password}\n`, {mode: 0o600});
			}
		}

		if (!username || !password) {
			this.error('OTTER_USERNAME and OTTER_PASSWORD must be set');
		}

		this.logTiming('login: calling Otter API');

		const result = execSync(
			`curl -s -w '\\n%{http_code}' "${API_BASE}/login?username=${encodeURIComponent(username)}" -u "${username}:${password}" -c "${COOKIE_FILE}"`,
			{encoding: 'utf8'},
		);

		const lines = result.trim().split('\n');
		const httpCode = lines.at(-1);
		const body = lines.slice(0, -1).join('\n');

		if (httpCode !== '200') {
			this.error(`Login failed with status ${httpCode}: ${body}`);
		}

		const data = JSON.parse(body);
		fs.writeFileSync(USERID_FILE, String(data.userid));
		this.logTiming('login: complete');
	}

	private curlGet(url: string, referer: string): string {
		return execSync(`curl -s "${url}" -H 'accept: application/json' -H 'referer: ${referer}' -b "${COOKIE_FILE}"`, {
			encoding: 'utf8',
		});
	}

	private async fetchAvailableSpeeches(
		pageSize: number,
		cursor?: string,
		modifiedAfter?: string,
	): Promise<{speeches: OtterSpeech[]; last_load_ts: string; end_of_list: boolean}> {
		this.logTiming(`available_speeches: page_size=${pageSize}`);

		let url = `${API_BASE}/available_speeches?page_size=${pageSize}&funnel=home_feed&source=home`;

		if (cursor) {
			url += `&last_load_ts=${cursor}`;
		}
		if (modifiedAfter) {
			url += `&modified_after=${modifiedAfter}`;
		}

		const response = this.curlGet(url, 'https://otter.ai/all-notes');
		const data = JSON.parse(response);

		this.logTiming('available_speeches: done');
		return data;
	}

	private async fetchActionItems(otid: string): Promise<ActionItem[]> {
		this.logTiming(`action_items: fetching ${otid}`);

		try {
			const url = `${API_BASE}/speech_action_items?otid=${otid}`;
			const response = this.curlGet(url, `https://otter.ai/u/${otid}`);
			const data = JSON.parse(response);

			const items: ActionItem[] = [];
			for (const item of data.speech_action_items || []) {
				items.push({
					text: item.text,
					assignee: item.assignee?.name ?? null,
					completed: item.completed ?? false,
				});
			}

			this.logTiming(`action_items: done ${otid}`);
			return items;
		} catch {
			this.logTiming(`action_items: error ${otid}`);
			return [];
		}
	}
}
