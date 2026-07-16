import {WorkflowyApiClient} from '@workflowy/shared/api';
import {PathBuilder, WorkflowyWriteThroughClient} from '@workflowy/shared/cache';
import {Command, Flags} from '@oclif/core';
import {createDatabase} from '../../db/index.js';
import {CacheService} from '../../services/cache.js';
import {logger} from '../../services/logger.js';
import {resolveNodeId} from '@workflowy/shared/utils';

export default class Update extends Command {
	static override description = 'Update a Workflowy node';

	static override examples = [
		'# Update node name by ID',
		'<%= config.bin %> <%= command.id %> --id abc123 --name "Updated Task"',
		'',
		'# Update node by path',
		'<%= config.bin %> <%= command.id %> --path "Work,Tasks,Old Name" --name "New Name"',
		'',
		'# Update note only',
		'<%= config.bin %> <%= command.id %> --id abc123 --note "Additional details"',
		'',
		'# Update both name and note',
		'<%= config.bin %> <%= command.id %> --id abc123 --name "Updated" --note "With note"',
		'',
		'# Clear the note from a node',
		'<%= config.bin %> <%= command.id %> --id abc123 --clear-note',
		'',
		'# Preview the API call without updating',
		'<%= config.bin %> <%= command.id %> --id abc123 --name "Updated" --dry-run',
	];

	static override flags = {
		id: Flags.string({
			char: 'i',
			description: 'ID of the node to update',
			exclusive: ['path'],
		}),
		path: Flags.string({
			char: 'p',
			description: 'Comma-separated path to the node (e.g., "Work,Tasks,My Task")',
			exclusive: ['id'],
		}),
		name: Flags.string({
			char: 'n',
			description: 'New name for the node',
		}),
		note: Flags.string({
			description: 'New note/description for the node',
			exclusive: ['clear-note'],
		}),
		'clear-note': Flags.boolean({
			description: 'Clear the note from the node',
			default: false,
			exclusive: ['note'],
		}),
		'layout-mode': Flags.string({
			description: 'Layout mode for the node (e.g., "todo", "document", "board")',
		}),
		'expect-name': Flags.string({
			description:
				"Refuse the update unless the node's current name exactly equals this value (guards against overwriting text that changed since it was read)",
		}),
		'dry-run': Flags.boolean({
			char: 'd',
			description: 'Show the API call that would be made without executing',
			default: false,
		}),
	};

	public async run(): Promise<void> {
		const {flags} = await this.parse(Update);

		if (!flags.id && !flags.path) {
			this.error('Either --id or --path is required');
		}

		if (!flags.name && !flags.note && !flags['clear-note'] && !flags['layout-mode']) {
			this.error('At least one of --name, --note, --clear-note, or --layout-mode must be provided');
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

		if (flags['expect-name'] !== undefined && !flags['dry-run']) {
			const current = await cacheService.getNode(nodeId);
			if (!current || current.name !== flags['expect-name']) {
				this.error(
					`Refusing to update ${nodeId}: current name does not match --expect-name ` +
						`(the node likely changed since it was read).\n` +
						`  expected: ${JSON.stringify(flags['expect-name'])}\n` +
						`  actual:   ${JSON.stringify(current?.name ?? null)}`,
				);
			}
		}

		const fullPath = await pathBuilder.buildFullPath(nodeId);

		if (flags['dry-run']) {
			const requestBody: {name?: string; note?: string; layoutMode?: string} = {};
			if (flags.name) {
				requestBody.name = flags.name;
			}
			if (flags.note) {
				requestBody.note = flags.note;
			} else if (flags['clear-note']) {
				requestBody.note = '';
			}
			if (flags['layout-mode']) {
				requestBody.layoutMode = flags['layout-mode'];
			}

			this.log('Would execute API call:');
			this.log(`  Method: POST`);
			this.log(`  URL: https://workflowy.com/api/v1/nodes/${nodeId}`);
			this.log('  Headers:');
			this.log('    Authorization: Bearer <WORKFLOWY_API_KEY>');
			this.log('    Content-Type: application/json');
			this.log('  Body:');
			this.log(`    ${JSON.stringify(requestBody, null, 2).split('\n').join('\n    ')}`);
			this.log('');
			this.log(`Node: ${fullPath}`);
		} else {
			this.log(`Updating node: ${fullPath}`);

			await client.updateNode(nodeId, {
				name: flags.name,
				note: flags['clear-note'] ? '' : flags.note,
				layoutMode: flags['layout-mode'],
			});

			this.log('');
			this.log(`Successfully updated node`);
			if (flags.name) {
				this.log(`  New name: ${flags.name}`);
			}
			if (flags.note) {
				this.log(`  New note: ${flags.note}`);
			} else if (flags['clear-note']) {
				this.log(`  Note cleared`);
			}
			if (flags['layout-mode']) {
				this.log(`  Layout mode: ${flags['layout-mode']}`);
			}
		}
	}
}
