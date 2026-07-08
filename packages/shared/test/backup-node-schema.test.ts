import {BackupNodeSchema, MetadataSchema} from '@workflowy/shared/schemas';
import {describe, expect, it} from 'vitest';

/**
 * Regression test for Workflowy's "tables" feature. A node rendered as a table
 * carries `metadata.table = {headers: true}`. `MetadataSchema` is `.strict()`,
 * so an undeclared key makes a whole backup import abort with an
 * `unrecognized_keys` ZodError. The field is accepted-but-ignored: no consumer
 * reads it, it just must not be rejected.
 */
describe('MetadataSchema table field', () => {
	it('accepts the table key on metadata', () => {
		const result = MetadataSchema.parse({table: {headers: true}});
		expect(result.table).toStrictEqual({headers: true});
	});

	it('accepts a node whose metadata carries a table', () => {
		const node = BackupNodeSchema.parse({
			id: 'abc',
			nm: 'A table node',
			metadata: {table: {headers: true}},
		});
		expect(node.metadata.table).toStrictEqual({headers: true});
	});
});
