import type {Logger as DrizzleLogger} from 'drizzle-orm';

/**
 * Custom Drizzle logger that routes SQL queries to console with appropriate severity.
 * READ operations (SELECT): debug severity
 * WRITE operations (INSERT, UPDATE, DELETE): info severity
 *
 * SQL logging is controlled by the WORKFLOWY_SQL_QUERY_LOGGING environment variable.
 */
export const sqlLogger: DrizzleLogger = {
	logQuery(query: string, params: unknown[]): void {
		if (process.env.WORKFLOWY_SQL_QUERY_LOGGING !== 'true') {
			return;
		}

		const isWrite = /^\s*(INSERT|UPDATE|DELETE)/i.test(query);

		if (isWrite) {
			console.info('[SQL]', query, params);
		} else {
			console.debug('[SQL]', query, params);
		}
	},
};
