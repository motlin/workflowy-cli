/** Kept apart from `internal-api.ts` (which imports Hono) so host-neutral ops can share the message. */
export const INTERNAL_API_NOT_CONFIGURED =
	"Workflowy internal API is not configured (set WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD, or run './bin/run.js internal login')";
