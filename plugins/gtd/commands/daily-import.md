---
name: daily-import
description: Refresh the Workflowy cache and review subtree for the daily review's mandatory import barrier.
---

# Daily Import

Run the barrier without piping or masking either exit status:

```bash
op run -- just daily
./bin/run.js cache sync-node --path "Personal,🔄 Review" --recursive
```

Verify that `cache import-api` reported fetched and changed node counts, the counts are sane, the subtree sync succeeded, and today's data is present. Return success only after positive verification. On error, timeout, missing summary, or stale data, return failure and halt the daily review.
