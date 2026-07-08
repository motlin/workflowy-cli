import {Flags} from '@oclif/core';
import {BaseListCommand} from '../base-list-command.js';
import {ListByIdService} from '../../services/list-by-id.js';
import {formatDuration} from '../../utils/format-duration.js';
import {logger} from '../../services/logger.js';

export default class List extends BaseListCommand {
	static override hidden = false;
	static override description = 'List Workflowy nodes by parent node ID';

	static override examples = [
		'<%= config.bin %> <%= command.id %>',
		'<%= config.bin %> <%= command.id %> --parent-id abc123',
		'<%= config.bin %> <%= command.id %> --parent-id abc123 --force-refresh',
	];

	static override flags = {
		'parent-id': Flags.string({
			char: 'p',
			description: 'Parent node ID (omit for root nodes)',
		}),
		'data-source': Flags.string({
			char: 'd',
			description: 'Data source to use: auto (default), api, or cache',
			options: ['auto', 'api', 'cache'],
			default: 'auto',
		}),
		incomplete: Flags.boolean({
			description: 'Only show incomplete (not completed) nodes',
			default: false,
		}),
		...BaseListCommand.baseFlags,
	};

	public async run(): Promise<void> {
		const {flags} = await this.parse(List);

		this.initializeApiClient();

		const service = new ListByIdService(this.cacheService, this.apiClient);

		try {
			// Resolve parent ID, supporting short IDs (12 hex chars from Workflowy URLs)
			let parentId: string | null = flags['parent-id'] ?? null;
			if (parentId) {
				const shortIdPattern = /^[0-9a-f]{12}$/i;
				if (shortIdPattern.test(parentId)) {
					const resolvedId = await this.cacheService.resolveShortIdToUuid(parentId);
					if (resolvedId) {
						logger.debug(`Resolved short ID ${parentId} to full UUID ${resolvedId}`);
						parentId = resolvedId;
					} else {
						this.error(`No node found for short ID: ${parentId}`);
					}
				}
			}

			const result = await service.listNodes({
				parentId,
				dataSource: flags['data-source'] as 'auto' | 'api' | 'cache',
				forceRefresh: flags['force-refresh'],
				depth: flags.depth,
			});

			if (result.cacheInfo && !flags.json) {
				this.log(
					`Using cached data (age: ${formatDuration(result.cacheInfo.age)}, sources: ${result.cacheInfo.sources.join(', ')})`,
				);
			} else if (result.fromApi && !flags.json) {
				this.log(`Fetched fresh data from API`);
			}

			if (flags.incomplete) {
				result.nodes = result.nodes.filter((node) => node.completedAt === null);
			}

			if (result.nodes.length === 0) {
				if (!result.fromApi && !this.apiClient) {
					this.log('No nodes found in cache. Set WORKFLOWY_API_KEY to fetch from API.');
				} else {
					this.log('No nodes found');
				}
			} else {
				await this.displayNodes(result.nodes, flags);
			}
		} catch (error) {
			this.error(`Failed to fetch nodes: ${String(error)}`);
		}
	}
}
