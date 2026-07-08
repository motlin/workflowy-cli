import {WorkflowyApiClient} from '@workflowy/shared/api';
import {Command, Flags} from '@oclif/core';
import {createDatabase} from '../../db/index.js';
import {type ImportApiResult, importFromApi} from '../../services/cache-import-api.js';
import {logger} from '../../services/logger.js';

export default class ImportApi extends Command {
	static override description = 'Import all nodes from Workflowy API export endpoint';

	static override examples = ['<%= config.bin %> cache:import-api', '<%= config.bin %> cache:import-api --dry-run'];

	static override flags = {
		'dry-run': Flags.boolean({
			char: 'd',
			description: 'Show what would be imported without making changes',
			default: false,
		}),
		verbose: Flags.boolean({
			char: 'v',
			description: 'Show detailed timing information',
			default: false,
		}),
	};

	public async run(): Promise<void> {
		const {flags} = await this.parse(ImportApi);

		const apiKey = process.env.WORKFLOWY_API_KEY;
		if (!apiKey) {
			this.error('WORKFLOWY_API_KEY environment variable is required');
		}

		const startTime = Date.now();

		try {
			this.log('Fetching all nodes from Workflowy API...');

			const apiClient = new WorkflowyApiClient(apiKey, logger, process.env.WORKFLOWY_API_URL);
			const nodes = await apiClient.exportAllNodes();

			const fetchElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
			this.log(`Fetched ${nodes.length.toLocaleString()} nodes in ${fetchElapsed}s`);

			if (flags['dry-run']) {
				this.log('\n[DRY RUN] Would import to cache:');
				this.log(`  Total nodes: ${nodes.length.toLocaleString()}`);
				this.log('  No changes made.');
				return;
			}

			const database = createDatabase();
			const result: ImportApiResult = await importFromApi(database, nodes, flags.verbose);

			const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);

			const changedCount = result.nodesAdded + result.nodesUpdated + result.nodesDeleted;

			if (changedCount === 0) {
				this.log(`\nNo changes (${result.totalNodes.toLocaleString()} nodes in ${totalElapsed}s)`);
			} else {
				this.log(
					`\n+${result.nodesAdded.toLocaleString()} added, ` +
						`~${result.nodesUpdated.toLocaleString()} updated ` +
						`(${result.contentUpdated.toLocaleString()} content, ${result.priorityUpdated.toLocaleString()} priority, ${result.metadataUpdated.toLocaleString()} metadata), ` +
						`=${result.nodesUnchanged.toLocaleString()} unchanged, ` +
						`-${result.nodesDeleted.toLocaleString()} deleted`,
				);
				this.log(
					`(${result.nodesAdded} + ${result.nodesUpdated} + ${result.nodesUnchanged} + ${result.nodesDeleted} = ${result.totalNodes.toLocaleString()} nodes in ${totalElapsed}s)`,
				);
			}
		} catch (error) {
			if (error instanceof Error && error.message.includes('429')) {
				this.error('Rate limit exceeded. Please wait 1 minute before trying again.');
			}
			this.error(`Failed to import from API: ${String(error)}`);
		}
	}
}
