---
description: Drizzle ORM migration patterns for this project. Use when creating database migrations, understanding why meta files are version controlled, or troubleshooting migration issues.
---

# Database Migrations

This project uses Drizzle ORM for database schema management and migrations.

## Migration Folder Structure

```text
src/db/migrations/
├── meta/
│   ├── _journal.json
│   └── 0000_snapshot.json
└── 0000_initial_migration.sql
```

## Why meta/ Files Are Version Controlled

**The `src/db/migrations/meta/` folder MUST be version controlled.**

Drizzle official documentation states: "Don't put anything from the drizzle folder into gitignore"

Reasons:

- **Snapshot comparison** - Drizzle Kit compares previous snapshots to current schema when generating migrations
- **Team consistency** - All developers need identical snapshots to generate consistent migrations
- **Migration ordering** - The `_journal.json` tracks migration order and is required for applying migrations
- **Deterministic builds** - Without tracked meta files, different developers would generate different migrations for the same schema changes

The meta files are generated output, but they are **required inputs** for future migration generation. This is why they must be tracked in version control.

## Generating Migrations

Always use `drizzle-kit generate` with the `--name` flag to create migrations:

```bash
npx drizzle-kit generate --name descriptive_migration_name
```

This generates both the SQL file and updates `meta/_journal.json` automatically. Never create migration SQL files manually without also updating the journal.
