# `just --list --unsorted`
[group('default')]
default:
    @just --list --unsorted

ci := env("CI", "")

# Install dependencies and rebuild native modules
[group('setup')]
install:
    vp install
    just ensure-sqlite-native
    vp fmt CLAUDE.md

# Verify better-sqlite3 native modules match the active Node runtime
[group('setup')]
ensure-sqlite-native:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -d node_modules/.pnpm ]; then
        exit 0
    fi
    find node_modules/.pnpm -path "*/node_modules/better-sqlite3/package.json" -print | sort | while IFS= read -r package_json; do
        package_dir="$PWD/$(dirname "$package_json")"
        if node -e 'const Database = require(process.argv[1]); new Database(":memory:").close();' "$package_dir" >/dev/null 2>&1; then
            continue
        fi
        rm -rf "$package_dir/build"
        pnpm --dir "$package_dir" run build-release
        node -e 'const Database = require(process.argv[1]); new Database(":memory:").close();' "$package_dir"
    done

# Run dev server
dev *args: build-shared
    WORKFLOWY_DB_PATH={{justfile_directory()}}/workflowy.sqlite vp run --filter @workflowy/web dev {{args}}

# Run linter
[group('lint')]
lint: install
    vp lint {{ if ci != "" { "--format github" } else { "--fix" } }}

# Run formatter
[group('lint')]
format: install
    vp fmt {{ if ci != "" { "--check" } else { "" } }}

# Run checks (format + lint + typecheck)
[group('lint')]
check: install
    vp check {{ if ci != "" { "" } else { "--fix" } }}

# Run tests
[group('test')]
test *args: build-shared
    CHAI_TRUNCATE_THRESHOLD=0 vp test run {{args}}

# Run the plugin script tests, which vitest does not glob
[group('test')]
test-plugins:
    node --test plugins/gtd/scripts/*.test.mjs

# Type-check the project
[group('build')]
typecheck: install
    vp run typecheck

# Remove all dist dirs and tsbuildinfo to prevent stale artifacts (used by git-test)
[group('build')]
clean:
    rm -rf \
        packages/shared/dist \
        packages/shared/tsconfig.tsbuildinfo \
        packages/shared/test/tsconfig.tsbuildinfo \
        packages/cli/dist \
        packages/cli/tsconfig.tsbuildinfo \
        packages/cli/test/tsconfig.tsbuildinfo \
        packages/mcp/dist \
        packages/mcp/tsconfig.tsbuildinfo \
        packages/web/dist \
        packages/web/tsconfig.tsbuildinfo \
        dist-test \
        dist-test/tsconfig.tsbuildinfo

# Build the project
[group('build')]
build: build-shared
    vp run build

# Run fallow codebase intelligence (dead code, duplication, drift)
[group('build')]
fallow: install
    vp run {{ if ci != "" { "fallow:ci" } else { "fallow" } }}

# Build the shared package
[group('build')]
build-shared: install
    vp run --filter @workflowy/shared build

# `vp run --filter @workflowy/cli prepack`
[group('build')]
manifest: install
    vp run --filter @workflowy/cli prepack

# Run structural eval tests against .claude/ markdown files
[group('test')]
eval-structural: build manifest
    CHAI_TRUNCATE_THRESHOLD=0 vp run eval:structural

# Run deterministic behavioral evals (no LLM calls needed)
[group('test')]
eval-deterministic: build
    CHAI_TRUNCATE_THRESHOLD=0 vp run eval:deterministic

# Run Tier 1 leaf agent evals (requires ANTHROPIC_API_KEY)
[group('test')]
eval-leaf: build
    CHAI_TRUNCATE_THRESHOLD=0 vp run eval:leaf

# Run Tier 2 orchestrator evals with recursive subagents (requires ANTHROPIC_API_KEY)
[group('test')]
eval-orchestrator: build
    CHAI_TRUNCATE_THRESHOLD=0 vp run eval:orchestrator

# Run Tier 3 end-to-end evals (requires ANTHROPIC_API_KEY, expensive)
[group('test')]
eval-e2e: build
    CHAI_TRUNCATE_THRESHOLD=0 vp run eval:e2e

# Run all behavioral eval tests (expensive, not in precommit)
[group('test')]
eval-behavioral: build
    CHAI_TRUNCATE_THRESHOLD=0 vp run eval:behavioral

# Run pre-commit hooks on all files (same as CI's pre-commit job)
[group('lint')]
pre-commit: build-shared
    pre-commit run --all-files

# Run all pre-commit checks
[group('workflow')]
precommit: check typecheck build fallow test test-plugins manifest eval-structural pre-commit
    @echo "All pre-commit checks passed!"

# Backup database before operations that modify it
[group('database')]
backup-db:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -f workflowy.sqlite ]; then
        cp workflowy.sqlite workflowy.sqlite.bak
        echo "Database backed up to workflowy.sqlite.bak"
    else
        echo "No database to backup (workflowy.sqlite not found)"
    fi

# Run daily workflow: import backup files, then update from API, generate embeddings, then reclaim dead pages
[group('workflow')]
daily: install backup-db
    ./bin/run.js cache import-backups --no-embeddings
    ./bin/run.js cache import-api
    ./bin/run.js ai embed
    # Reclaim dead pages so the db file does not regrow unbounded (full VACUUM; logs before/after sizes)
    ./bin/run.js cache vacuum

# Delete database and run full workflow from scratch
[group('workflow')]
fresh: install
    #!/usr/bin/env bash
    set -euo pipefail
    rm -f workflowy.sqlite
    just download-backups
    find backups -type f \( -name "*.workflowy.backup" -o -name "workflowy-backup-*.json" \) | sort | while read file; do
        ./bin/run.js cache import-backup --file "$file" --yes
    done

# Demo CLI commands - comprehensive exploration of all CLI functionality
[group('demo')]
demo:
    @./scripts/demo.sh

# `open -a "DB Browser for SQLite" workflowy.sqlite`
[group('database')]
db-browser:
    open -a "DB Browser for SQLite" workflowy.sqlite

# `sqlite3 workflowy.sqlite`
[group('database')]
db-cli:
    sqlite3 workflowy.sqlite

# `datasette workflowy.sqlite`
[group('database')]
db-web:
    datasette workflowy.sqlite

# Start web app with API server and Vite dev server
[group('web')]
web: build-shared
    WORKFLOWY_DB_PATH={{justfile_directory()}}/workflowy.sqlite vp run --filter @workflowy/web dev

# Download all available Dropbox backups that aren't already downloaded
[group('backup')]
download-backups:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Syncing Workflowy backups from Dropbox (Dropbox keeps last 3 days)"
    echo ""

    mkdir -p backups/Data
    mkdir -p backups/History

    AVAILABLE=$(./bin/run.js dropbox list-backups 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}' || true)

    if [ -z "$AVAILABLE" ]; then
        echo "No backups found in Dropbox or authentication failed"
        echo "Run: ./bin/run.js dropbox:auth"
        exit 1
    fi

    TOTAL=0
    SKIPPED=0
    DOWNLOADED=0

    while IFS= read -r line; do
        DATE=$(echo "$line" | awk '{print $1}')
        SOURCE=$(echo "$line" | awk '{print $2}')

        if [ -z "$DATE" ] || [ "$DATE" = "unknown" ]; then
            continue
        fi

        TOTAL=$((TOTAL + 1))

        if find backups -type f -name "*${DATE}*" 2>/dev/null | grep -q .; then
            echo "Already have: $DATE ($SOURCE)"
            SKIPPED=$((SKIPPED + 1))
        else
            echo "Downloading: $DATE ($SOURCE)"
            ./bin/run.js dropbox download-backup --date "$DATE" --quiet > /dev/null
            DOWNLOADED=$((DOWNLOADED + 1))
        fi
    done <<< "$AVAILABLE"

    echo ""
    echo "Dropbox sync (keeps last 3 per folder):"
    echo "   In Dropbox:    $TOTAL"
    echo "   Already local: $SKIPPED"
    echo "   Downloaded:    $DOWNLOADED"
