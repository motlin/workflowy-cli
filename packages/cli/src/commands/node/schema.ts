import {Command, Flags} from '@oclif/core';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {schemaToInterface} from '../../utils/schema-to-interface.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findPackageRoot(): string {
	// At runtime __dirname is dist/commands/node/ — walk up to find package root
	let dir = __dirname;
	for (let i = 0; i < 10; i++) {
		if (dir.endsWith('/packages/cli') || dir.endsWith(String.raw`\packages\cli`)) return dir;
		dir = path.dirname(dir);
	}
	// Fallback: assume dist/commands/node -> 3 levels up
	return path.resolve(__dirname, '../../..');
}

const PKG_ROOT = findPackageRoot();

interface CommandTypeMapping {
	description: string;
	sourceFile: string;
	typeName: string;
	interfaceName: string;
}

const COMMAND_TYPE_MAP: Record<string, CommandTypeMapping> = {
	get: {
		description: 'node get --json',
		sourceFile: path.resolve(PKG_ROOT, '../shared/src/cache/node-tree-reader.ts'),
		typeName: 'NodeTree',
		interfaceName: 'NodeGetOutput',
	},
	list: {
		description: 'node list --json',
		sourceFile: path.resolve(PKG_ROOT, '../shared/src/cache/node-tree-reader.ts'),
		typeName: 'NodeTree',
		interfaceName: 'NodeListOutput',
	},
	search: {
		description: 'node search --json',
		sourceFile: path.resolve(PKG_ROOT, 'src/services/text-search.ts'),
		typeName: 'TextSearchResult',
		interfaceName: 'NodeSearchOutput',
	},
	changes: {
		description: 'node changes --json',
		sourceFile: path.resolve(PKG_ROOT, '../shared/src/changes/change-detector.ts'),
		typeName: 'ChangeDetectionResult',
		interfaceName: 'NodeChangesOutput',
	},
};

export default class Schema extends Command {
	static override description = 'Show JSON output schema for node commands (for LLM discovery)';

	static override examples = [
		'# Show all command output schemas',
		'<%= config.bin %> <%= command.id %>',
		'',
		'# Show schema for a specific command',
		'<%= config.bin %> <%= command.id %> --command get',
	];

	static override flags = {
		command: Flags.string({
			char: 'c',
			description: 'Which command output type to show',
			options: Object.keys(COMMAND_TYPE_MAP),
		}),
	};

	public async run(): Promise<void> {
		const {flags} = await this.parse(Schema);
		const {createGenerator} = await import('ts-json-schema-generator');

		const commands = flags.command ? [flags.command] : Object.keys(COMMAND_TYPE_MAP);

		for (const [i, cmd] of commands.entries()) {
			if (i > 0) this.log('');

			const mapping = COMMAND_TYPE_MAP[cmd];

			const tsconfigPath = path.resolve(PKG_ROOT, 'tsconfig.json');

			const generator = createGenerator({
				path: mapping.sourceFile,
				tsconfig: tsconfigPath,
				type: mapping.typeName,
				skipTypeCheck: true,
			});

			const jsonSchema = generator.createSchema(mapping.typeName);
			const interfaceText = schemaToInterface(jsonSchema, mapping.interfaceName);

			this.log(`// Output type for: ${mapping.description}`);
			this.log(`// Source: ${mapping.typeName}`);
			this.log(interfaceText);
		}
	}
}
