import {WorkflowyApiClient} from '@workflowy/shared/api';
import {PathBuilder, WorkflowyWriteThroughClient} from '@workflowy/shared/cache';
import {Command, Flags} from '@oclif/core';
import {createDatabase} from '../../db/index.js';
import {CacheService} from '../../services/cache.js';
import {logger} from '../../services/logger.js';
import {resolveNodeId} from '@workflowy/shared/utils';

export default class Delete extends Command {
	static override description = 'Delete a Workflowy node';

	static override examples = [
		'# Delete node by ID',
		'<%= config.bin %> <%= command.id %> --id abc123',
		'',
		'# Delete node by path',
		'<%= config.bin %> <%= command.id %> --path "Work,Tasks,Completed Task"',
		'',
		'# Preview the API call without deleting',
		'<%= config.bin %> <%= command.id %> --id abc123 --dry-run',
	];

	static override flags = {
		id: Flags.string({
			char: 'i',
			description: 'ID of the node to delete',
			exclusive: ['path'],
		}),
		path: Flags.string({
			char: 'p',
			description: 'Comma-separated path to the node (e.g., "Work,Tasks,Old Task")',
			exclusive: ['id'],
		}),
		'dry-run': Flags.boolean({
			char: 'd',
			description: 'Show the API call that would be made without executing',
			default: false,
		}),
	};

	public async run(): Promise<void> {
		const {flags} = await this.parse(Delete);

		if (!flags.id && !flags.path) {
			this.error('Either --id or --path is required');
		}

		const apiKey = process.env.WORKFLOWY_API_KEY;
		if (!apiKey) {
			this.error('WORKFLOWY_API_KEY environment variable is required');
		}

		const apiClient = new WorkflowyApiClient(apiKey, logger, process.env.WORKFLOWY_API_URL);
		const database = createDatabase();
		const cacheService = new CacheService(database);
		const client = new WorkflowyWriteThroughClient(apiClient, cacheService);
		const pathBuilder = new PathBuilder(database);

		const nodeId = await resolveNodeId(flags, cacheService, apiClient);

		const fullPath = await pathBuilder.buildFullPath(nodeId);

		if (flags['dry-run']) {
			this.log('Would execute API call:');
			this.log(`  Method: DELETE`);
			this.log(`  URL: https://workflowy.com/api/v1/nodes/${nodeId}`);
			this.log('  Headers:');
			this.log('    Authorization: Bearer <WORKFLOWY_API_KEY>');
			this.log('');
			this.log(`Node: ${fullPath}`);
			this.log('');
			this.log('WARNING: This will permanently delete the node and all its children!');
		} else {
			this.log(`Deleting node: ${fullPath}`);
			this.log('');
			this.log('WARNING: This will permanently delete the node and all its children!');

			await client.deleteNode(nodeId);

			// Update cache - close out the deleted node's temporal record
			await cacheService.deleteNode(nodeId);

			this.log('');
			this.log(`Successfully deleted node`);
		}
	}
}
