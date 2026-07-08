import {captureOutput} from '@oclif/test';
import Schema from '../../../src/commands/node/schema.js';

const EXPECTED_STDOUT = `// Output type for: node get --json
// Source: EnhancedCacheNode
interface NodeGetOutput {
  children?: NodeGetOutput[];
  linkTargets?: ({ shortId: string | null; children?: NodeGetOutput[]; id: string; name: string | null; note: string | null; parentId: string | null; priority: number | null; createdAt: string | null; modifiedAt: string | null; completedAt: string | null; layoutMode: string | null; systemFrom: string; systemTo: string; mirrorsAsOriginal?: { mirrorId: string }[]; mirrorsAsCopy?: { originalId: string }[]; backlinks?: { sourceId: string; targetId: string }[]; virtualRootIds?: { virtualRootId: string }[]; aiMetadata?: { inChat: number } | null; s3File?: { fileName: string; fileType: string; objectFolder: string | null; isAnimatedGif: number | null; imageOriginalWidth: number | null; imageOriginalHeight: number | null; imageOriginalPixels: number | null; isDeleted: number | null } | null; changesMetadata?: { ctBy: number } | null; referencesRoot?: { nodeId: string } | null; calendar?: { root: number | null; level: string | null; value: string | null; dateId: number | null; timestamp: number | null; foundDates: number | null; levels?: { day: number | null; week: number | null; month: number | null; year: number | null } | null } | null })[];
  isMirror?: boolean;
  mirrorOf?: string;
  id: string;
  shortId: string | null;
  name: string | null;
  note: string | null;
  parentId: string | null;
  priority: number | null;
  createdAt: string | null;
  modifiedAt: string | null;
  completedAt: string | null;
  layoutMode: string | null;
  systemFrom: string;
  systemTo: string;
  mirrorsAsOriginal?: { mirrorId: string }[];
  mirrorsAsCopy?: { originalId: string }[];
  backlinks?: { sourceId: string; targetId: string }[];
  virtualRootIds?: { virtualRootId: string }[];
  aiMetadata?: { inChat: number } | null;
  s3File?: { fileName: string; fileType: string; objectFolder: string | null; isAnimatedGif: number | null; imageOriginalWidth: number | null; imageOriginalHeight: number | null; imageOriginalPixels: number | null; isDeleted: number | null } | null;
  changesMetadata?: { ctBy: number } | null;
  referencesRoot?: { nodeId: string } | null;
  calendar?: { root: number | null; level: string | null; value: string | null; dateId: number | null; timestamp: number | null; foundDates: number | null; levels?: { day: number | null; week: number | null; month: number | null; year: number | null } | null } | null;
}



// Output type for: node list --json
// Source: EnhancedCacheNode
interface NodeListOutput {
  children?: NodeListOutput[];
  linkTargets?: ({ shortId: string | null; children?: NodeListOutput[]; id: string; name: string | null; note: string | null; parentId: string | null; priority: number | null; createdAt: string | null; modifiedAt: string | null; completedAt: string | null; layoutMode: string | null; systemFrom: string; systemTo: string; mirrorsAsOriginal?: { mirrorId: string }[]; mirrorsAsCopy?: { originalId: string }[]; backlinks?: { sourceId: string; targetId: string }[]; virtualRootIds?: { virtualRootId: string }[]; aiMetadata?: { inChat: number } | null; s3File?: { fileName: string; fileType: string; objectFolder: string | null; isAnimatedGif: number | null; imageOriginalWidth: number | null; imageOriginalHeight: number | null; imageOriginalPixels: number | null; isDeleted: number | null } | null; changesMetadata?: { ctBy: number } | null; referencesRoot?: { nodeId: string } | null; calendar?: { root: number | null; level: string | null; value: string | null; dateId: number | null; timestamp: number | null; foundDates: number | null; levels?: { day: number | null; week: number | null; month: number | null; year: number | null } | null } | null })[];
  isMirror?: boolean;
  mirrorOf?: string;
  id: string;
  shortId: string | null;
  name: string | null;
  note: string | null;
  parentId: string | null;
  priority: number | null;
  createdAt: string | null;
  modifiedAt: string | null;
  completedAt: string | null;
  layoutMode: string | null;
  systemFrom: string;
  systemTo: string;
  mirrorsAsOriginal?: { mirrorId: string }[];
  mirrorsAsCopy?: { originalId: string }[];
  backlinks?: { sourceId: string; targetId: string }[];
  virtualRootIds?: { virtualRootId: string }[];
  aiMetadata?: { inChat: number } | null;
  s3File?: { fileName: string; fileType: string; objectFolder: string | null; isAnimatedGif: number | null; imageOriginalWidth: number | null; imageOriginalHeight: number | null; imageOriginalPixels: number | null; isDeleted: number | null } | null;
  changesMetadata?: { ctBy: number } | null;
  referencesRoot?: { nodeId: string } | null;
  calendar?: { root: number | null; level: string | null; value: string | null; dateId: number | null; timestamp: number | null; foundDates: number | null; levels?: { day: number | null; week: number | null; month: number | null; year: number | null } | null } | null;
}



// Output type for: node search --json
// Source: TextSearchResult
interface NodeSearchOutput {
  shortId: string | null;
  name: string | null;
  note: string | null;
  path: string;
}

// Output type for: node changes --json
// Source: ChangeDetectionResult
interface NodeChangesOutput {
  changes: NodeChange[];
  tree: ChangeTreeNode[];
  summary: ChangeSummary;
  cutoffDate: string;
}

interface NodeChange {
  id: string;
  isNew: boolean;
  isDeleted: boolean;
  contentChanged: boolean;
  parentChanged: boolean;
  completionChanged: boolean;
  noteChanged: boolean;
  oldName: string | null;
  oldNote: string | null;
  oldParentId: string | null;
  oldCompletedAt: string | null;
  currentName: string | null;
  currentNote: string | null;
  currentParentId: string | null;
  currentCompletedAt: string | null;
  parentId: string | null;
}

interface ChangeTreeNode {
  id: string;
  name: string | null;
  isContext: boolean;
  change: NodeChange | null;
  children: ChangeTreeNode[];
}



interface ChangeSummary {
  added: number;
  deleted: number;
  changed: number;
  moved: number;
  completed: number;
  uncompleted: number;
}
`;

describe('node schema command', () => {
	it('generates schema for all commands', async () => {
		const {stdout} = await captureOutput(async () => {
			await Schema.run([]);
		});

		expect(stdout).toBe(EXPECTED_STDOUT);
	});

	it('has correct description', () => {
		expect(Schema.description).toBe('Show JSON output schema for node commands (for LLM discovery)');
	});

	it('has examples', () => {
		expect(Schema.examples).toStrictEqual([
			'# Show all command output schemas',
			'<%= config.bin %> <%= command.id %>',
			'',
			'# Show schema for a specific command',
			'<%= config.bin %> <%= command.id %> --command get',
		]);
	});
});
