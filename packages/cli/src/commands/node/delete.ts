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
		'# Preview the API calls without deleting',
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
			description: 'Show the API calls that would be made without executing',
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
		const plan = await client.planDelete(nodeId);
		const removingMirror = plan.nodeId === null;
		const innerMirrorPaths = removingMirror
			? []
			: await Promise.all(plan.mirrorIds.map((id) => pathBuilder.buildFullPath(id)));
		const outsidePaths = await Promise.all(plan.outsideMirrorIds.map((id) => pathBuilder.buildFullPath(id)));
		const warning = removingMirror
			? "WARNING: This removes only this mirror; its original and the original's children are kept."
			: 'WARNING: This will permanently delete the node and all its children!';

		if (flags['dry-run']) {
			this.log('Would execute API calls:');
			for (const id of plan.mirrorIds) {
				this.log(`  DELETE https://workflowy.com/api/v1/nodes/${id}/mirror`);
			}
			if (plan.nodeId !== null) {
				this.log(`  DELETE https://workflowy.com/api/v1/nodes/${plan.nodeId}`);
			}
			this.log('  Headers:');
			this.log('    Authorization: Bearer <WORKFLOWY_API_KEY>');
			this.log('');
			this.log(`Node: ${fullPath}`);
			this.logMirrorSections(innerMirrorPaths, outsidePaths);
			this.log('');
			this.log(warning);
		} else {
			this.log(`${removingMirror ? 'Removing mirror' : 'Deleting node'}: ${fullPath}`);
			this.logMirrorSections(innerMirrorPaths, outsidePaths);
			this.log('');
			this.log(warning);

			await client.deleteNode(nodeId);

			this.log('');
			this.log(removingMirror ? 'Successfully removed mirror' : 'Successfully deleted node');
		}
	}

	private logMirrorSections(innerMirrorPaths: string[], outsideMirrorPaths: string[]): void {
		if (innerMirrorPaths.length > 0) {
			this.log('');
			this.log('Mirrors removed first through the mirror endpoint, so their originals drop the reference:');
			for (const mirrorPath of innerMirrorPaths) this.log(`  ${mirrorPath}`);
		}
		if (outsideMirrorPaths.length > 0) {
			this.log('');
			this.log('Mirrors elsewhere of nodes being deleted, left in place:');
			for (const mirrorPath of outsideMirrorPaths) this.log(`  ${mirrorPath}`);
		}
	}
}
