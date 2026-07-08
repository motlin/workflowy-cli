import type {Config} from 'drizzle-kit';

export default {
	schema: './packages/shared/src/db/schema.ts',
	out: './packages/shared/src/db/migrations',
	dialect: 'sqlite',
	dbCredentials: {
		url: './workflowy.sqlite',
	},
} satisfies Config;
