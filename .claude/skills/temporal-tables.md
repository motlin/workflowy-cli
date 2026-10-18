---
description: Query patterns for temporal tables with system_from/system_to validity periods
---

# Temporal Table Query Patterns

When working with temporal tables (tables with `system_from` and `system_to` columns), the query pattern is:

**Correct: Use strict inequality (system_from <= T AND system_to > T)**

```sql
WHERE system_from <= '2024-06-15 14:30:00' AND system_to > '2024-06-15 14:30:00'
```

This ensures exactly one row matches at any point in time, even when rows have contiguous timestamps (system_to of row N = system_from of row N+1). Do NOT use `BETWEEN` because `<=` on both sides would match two rows at the boundary.

**Wrong: Check if system_from is BETWEEN two dates**

```sql
-- This is NOT how temporal tables work
WHERE system_from BETWEEN '2024-01-01 00:00:00' AND '2024-12-31 23:59:59'
```

Temporal tables store validity periods. We query "what was valid at this point in time?" not "when did this validity period start?"

## Timestamp Format

All temporal columns use ISO8601 TEXT format: `YYYY-MM-DD HH:MM:SS`

- `system_from`: Start of validity period (defaults to current time)
- `system_to`: End of validity period (defaults to `9999-12-31 23:59:59` for current records)

Example schema:

```sql
CREATE TABLE nodes (
  id TEXT NOT NULL,
  name TEXT,
  system_from TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
  system_to TEXT NOT NULL DEFAULT '9999-12-31 23:59:59',
  PRIMARY KEY (id, system_from)
);
```

Example queries:

```sql
-- Query current records
SELECT * FROM nodes WHERE system_to = '9999-12-31 23:59:59';

-- Query records as of a specific date (strict > on system_to)
SELECT * FROM nodes WHERE system_from <= '2024-06-15 14:30:00' AND system_to > '2024-06-15 14:30:00';

-- Query historical records at backup import time
SELECT * FROM nodes WHERE system_from <= @importTimestamp AND system_to > @importTimestamp;
```

## Composites

See Liftwizard's [Composites](https://liftwizard.io/docs/temporal-data/versioning#composites) and [Reladomo](https://github.com/goldmansachs/reladomo).

- A node is the composite root. The ownership map is `NODE_COMPOSITE_PARTS` in `packages/shared/src/cache/node-composite.ts`; `packages/shared/test/node-composite.test.ts` fails when a table or node-id column is unclassified.
- Here the leading primary-key column names the owner; every other node-id column is a reference.
- Unit of work: one logical operation may edit several composites, and all of them share one transaction and one system time (`UnitOfWork` from `runUnitOfWork`). That time is every ended row's `system_to` and every new row's `system_from`. Helpers take the unit of work from the caller and never call `now()` or open their own transaction.
- Every write path that ends or merges composites runs one `runUnitOfWork`: `applyRows`, `endNodeComposites` and `endOrphanedParts` take the caller's `UnitOfWork`. Examples: `CacheService.deleteNode` and `promoteOriginal`, `importFromApi` (merge plus `endOrphanedParts`), and the backup import (node, relationship and orphan sweep in one transaction). Never close an owned table ad hoc.
