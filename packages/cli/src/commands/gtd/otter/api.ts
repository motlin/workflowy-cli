import {Args, Command, Flags} from '@oclif/core';
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

interface OtterActionItem {
	text: string;
	assignee?: {name: string};
	completed: boolean;
}

interface AvailableSpeechesResponse {
	speeches: OtterSpeech[];
	last_load_ts: string;
	end_of_list: boolean;
}

interface ActionItemsResponse {
	speech_action_items: OtterActionItem[];
}

/**
 * Otter.ai API wrapper - fetches meetings with authentication.
 *
 * Requires environment variables:
 *   OTTER_USERNAME - Otter.ai account email (or op:// reference)
 *   OTTER_PASSWORD - Otter.ai account password (or op:// reference)
 */
export default class Api extends Command {
	static override description = 'Otter.ai API wrapper for fetching meetings';

	static override examples = [
		'# List available speeches',
		'<%= config.bin %> <%= command.id %> available_speeches',
		'',
		'# Get speech details',
		'<%= config.bin %> <%= command.id %> speech --otid abc123',
		'',
		'# Get action items for a speech',
		'<%= config.bin %> <%= command.id %> action_items --otid abc123',
	];

	static override args = {
		command: Args.string({
			description: 'API command to execute',
			required: true,
			options: ['available_speeches', 'speech', 'summary', 'action_items'],
		}),
	};

	static override flags = {
		otid: Flags.string({
			description: 'Otter transcript ID (required for speech, summary, action_items)',
		}),
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
	};

	private verbose = process.env.OTTER_VERBOSE === '1';
	private startTime = Date.now();

	public async run(): Promise<unknown> {
		const {args, flags} = await this.parse(Api);

		const {command} = args;

		switch (command) {
			case 'available_speeches': {
				return this.availableSpeeches(flags);
			}
			case 'speech': {
				if (!flags.otid) {
					this.error('--otid is required for speech command');
				}
				return this.speech(flags.otid);
			}
			case 'summary': {
				if (!flags.otid) {
					this.error('--otid is required for summary command');
				}
				return this.summary(flags.otid);
			}
			case 'action_items': {
				if (!flags.otid) {
					this.error('--otid is required for action_items command');
				}
				return this.actionItems(flags.otid);
			}
			default: {
				this.error(`Unknown command: ${command}`);
			}
		}
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
		return age < 3600; // 1 hour
	}

	private async login(): Promise<void> {
		this.logTiming('login: start');

		if (this.cookieValid() && fs.existsSync(USERID_FILE)) {
			this.logTiming('login: using cached session');
			return;
		}

		let username = process.env.OTTER_USERNAME ?? '';
		let password = process.env.OTTER_PASSWORD ?? '';

		// Handle 1Password references
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

		// Use curl for login since it handles cookie jar format correctly
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

	private async availableSpeeches(flags: {
		'page-size': number;
		cursor?: string;
		'modified-after'?: string;
	}): Promise<AvailableSpeechesResponse> {
		await this.login();

		this.logTiming(`available_speeches: page_size=${flags['page-size']}`);

		let url = `${API_BASE}/available_speeches?page_size=${flags['page-size']}&funnel=home_feed&source=home`;

		if (flags.cursor) {
			url += `&last_load_ts=${flags.cursor}`;
		}
		if (flags['modified-after']) {
			url += `&modified_after=${flags['modified-after']}`;
		}

		const response = this.curlGet(url, 'https://otter.ai/all-notes');
		const data = JSON.parse(response) as AvailableSpeechesResponse;

		this.logTiming('available_speeches: done');
		this.log(JSON.stringify(data, null, 2));
		return data;
	}

	private async speech(otid: string): Promise<unknown> {
		await this.login();

		this.logTiming(`speech: fetching ${otid}`);

		const url = `${API_BASE}/speech?otid=${otid}`;
		const response = this.curlGet(url, `https://otter.ai/u/${otid}`);
		const data = JSON.parse(response);

		this.logTiming('speech: done');
		this.log(JSON.stringify(data, null, 2));
		return data;
	}

	private async summary(otid: string): Promise<unknown> {
		await this.login();

		this.logTiming(`summary: fetching ${otid}`);

		const url = `${API_BASE}/abstract_summary?otid=${otid}`;
		const response = this.curlGet(url, `https://otter.ai/u/${otid}`);
		const data = JSON.parse(response);

		this.logTiming('summary: done');
		this.log(JSON.stringify(data, null, 2));
		return data;
	}

	private async actionItems(otid: string): Promise<ActionItemsResponse> {
		await this.login();

		this.logTiming(`action_items: fetching ${otid}`);

		const url = `${API_BASE}/speech_action_items?otid=${otid}`;
		const response = this.curlGet(url, `https://otter.ai/u/${otid}`);
		const data = JSON.parse(response) as ActionItemsResponse;

		this.logTiming('action_items: done');
		this.log(JSON.stringify(data, null, 2));
		return data;
	}
}
