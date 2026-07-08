import {fetchWorkflowyEpoch} from '@workflowy/shared/api';
import {config} from '@workflowy/shared/db';
import {formatTemporalTimestamp} from '@workflowy/shared/temporal';
import {Command, Flags} from '@oclif/core';
import {eq} from 'drizzle-orm';
import {createDatabase} from '../../db/index.js';

const WORKFLOWY_EPOCH_CONFIG_KEY = 'workflowy_epoch';

export default class CacheConfig extends Command {
	static override description = 'Manage cache configuration settings like the Workflowy epoch';

	static override examples = [
		'<%= config.bin %> cache:config --get epoch',
		'<%= config.bin %> cache:config --set epoch=1324752241',
		'<%= config.bin %> cache:config --fetch-epoch',
	];

	static override flags = {
		get: Flags.string({
			char: 'g',
			description: 'Get a configuration value (e.g., "epoch")',
		}),
		set: Flags.string({
			char: 's',
			description: 'Set a configuration value (e.g., "epoch=1324752241")',
		}),
		'fetch-epoch': Flags.boolean({
			description:
				'Fetch and store the Workflowy epoch from internal API (requires WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD)',
		}),
	};

	public async run(): Promise<void> {
		const {flags} = await this.parse(CacheConfig);
		const database = createDatabase();

		if (flags['fetch-epoch']) {
			await this.fetchAndStoreEpoch(database);
			return;
		}

		if (flags.get) {
			this.getConfig(database, flags.get);
			return;
		}

		if (flags.set) {
			this.setConfig(database, flags.set);
			return;
		}

		// Show all config if no flags
		this.showAllConfig(database);
	}

	private async fetchAndStoreEpoch(database: ReturnType<typeof createDatabase>): Promise<void> {
		const username = process.env.WORKFLOWY_USERNAME;
		const password = process.env.WORKFLOWY_PASSWORD;

		if (!username || !password) {
			this.error('WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD environment variables are required');
		}

		this.log('Fetching Workflowy epoch from internal API...');

		try {
			const epoch = await fetchWorkflowyEpoch({username, password});
			const now = formatTemporalTimestamp(new Date());

			database
				.insert(config)
				.values({
					key: WORKFLOWY_EPOCH_CONFIG_KEY,
					value: String(epoch),
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: config.key,
					set: {
						value: String(epoch),
						updatedAt: now,
					},
				})
				.run();

			this.log(`Workflowy epoch stored: ${epoch}`);
			this.log(`(This is your account creation timestamp: ${new Date(epoch * 1000).toISOString()})`);
		} catch (error) {
			this.error(`Failed to fetch epoch: ${String(error)}`);
		}
	}

	private getConfig(database: ReturnType<typeof createDatabase>, key: string): void {
		if (key === 'epoch') {
			// Check env var first
			const envEpoch = process.env.WORKFLOWY_EPOCH;
			if (envEpoch) {
				this.log(`epoch=${envEpoch} (from WORKFLOWY_EPOCH env var)`);
				return;
			}

			// Check config table
			const row = database.select().from(config).where(eq(config.key, WORKFLOWY_EPOCH_CONFIG_KEY)).get();
			if (row) {
				this.log(`epoch=${row.value} (from config table)`);
				return;
			}

			this.log('epoch=<not configured>');
			this.log('\nTo configure, either:');
			this.log('  1. Set WORKFLOWY_EPOCH environment variable');
			this.log('  2. Run: ./bin/run.js cache:config --set epoch=<value>');
			this.log(
				'  3. Run: ./bin/run.js cache:config --fetch-epoch (requires WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD)',
			);
		} else {
			this.error(`Unknown config key: ${key}. Supported keys: epoch`);
		}
	}

	private setConfig(database: ReturnType<typeof createDatabase>, setting: string): void {
		const [key, value] = setting.split('=');

		if (!key || value === undefined) {
			this.error('Invalid format. Use: --set key=value');
		}

		if (key === 'epoch') {
			const epoch = Number.parseInt(value, 10);
			if (Number.isNaN(epoch)) {
				this.error('Invalid epoch value. Must be a number (Unix timestamp in seconds).');
			}

			const now = formatTemporalTimestamp(new Date());
			database
				.insert(config)
				.values({
					key: WORKFLOWY_EPOCH_CONFIG_KEY,
					value: String(epoch),
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: config.key,
					set: {
						value: String(epoch),
						updatedAt: now,
					},
				})
				.run();

			this.log(`epoch=${epoch}`);
			this.log(`(Account creation: ${new Date(epoch * 1000).toISOString()})`);
		} else {
			this.error(`Unknown config key: ${key}. Supported keys: epoch`);
		}
	}

	private showAllConfig(database: ReturnType<typeof createDatabase>): void {
		this.log('Cache Configuration:\n');

		// Epoch
		const envEpoch = process.env.WORKFLOWY_EPOCH;
		if (envEpoch) {
			this.log(`  epoch: ${envEpoch} (from WORKFLOWY_EPOCH env var)`);
		} else {
			const row = database.select().from(config).where(eq(config.key, WORKFLOWY_EPOCH_CONFIG_KEY)).get();
			if (row) {
				this.log(`  epoch: ${row.value} (from config table)`);
			} else {
				this.log('  epoch: <not configured>');
			}
		}

		this.log('\nUse --get <key> or --set <key>=<value> to manage settings.');
	}
}
