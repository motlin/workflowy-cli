---
name: refinement-tagger
description: 'Shared mechanics for the GTD inbox refinement taggers — the Phase A dimension taggers (project, people, due-date, url, context, tag-cleaner, agenda) and Phase B composers (destination, text) that item-refiner fans out per inbox item. Carries the common input/fetch pattern, where synced metadata lives, the JSON-only output contract, and how item-refiner reconciles the parallel results. Load it in every refinement tagger/composer agent so each agent body stays tiny.'
globs: ${CLAUDE_PLUGIN_ROOT}/agents/refinement/**
---

# Refinement tagger mechanics

`item-refiner` refines one inbox item by fanning out to several single-dimension **Phase A taggers** in parallel, then running the **Phase B composers** in order. Every tagger and composer follows the same shape — fetch the item, read synced metadata, return one JSON object. This skill holds that shared shape so each agent body only states its own focus and output JSON.

## Input

- The item's Workflowy node ID arrives via the prompt as `itemId`. There are no other inputs.
- Bind it once: `ITEM_ID="<the id from the prompt>"`.

## Fetch the item

Run `./bin/run.js node get --help` first to confirm available flags, then fetch text, note, and children in one call (mirror the snippet in `${CLAUDE_PLUGIN_ROOT}/agents/refinement/agenda-detector.md`):

```bash
ITEM=$(./bin/run.js node get --id "$ITEM_ID" --depth 2 --json --fields id --fields name --fields note --fields children 2>/dev/null)
ITEM_NAME=$(echo "$ITEM" | jq -r '.name')
```

Classify against `ITEM_NAME` plus any note/children context — captured items often carry the real signal (URLs, source, people) in children rather than the title.

## Where synced metadata lives

`gtd:metadata-sync` (see `${CLAUDE_PLUGIN_ROOT}/agents/shared/metadata-sync.md`) writes the cache before refinement runs. Read, never write, these files:

- `.llm/gtd/metadata/projects/*.json` — one file per project; match item text against project names/slugs.
- `.llm/gtd/metadata/people.json` — canonical people roster. It is large: extract with `jq`, never read the whole file into context.
- `.llm/gtd/metadata/contexts.json` — location/mode `#tags` (`#home`, `#call`, `#errands`, …).

If a needed file is missing or stale, emit a null/empty result with low confidence rather than guessing — a missing tag is cheap to add later.

## Output contract

- Return **ONLY** the JSON object for this agent's one dimension — no prose, no markdown fence in the actual reply, nothing else. `item-refiner` parses the raw object.
- Always include a `confidence` field, `0.0`–`1.0`.
- When there is no signal, emit the empty form (`null`, `[]`, or `false`) rather than inventing a value. Silence beats a wrong tag.
- Keep `reasoning` to one short sentence; it is for the human reviewing the `🔍 Refinement` node, not for downstream logic.

## Reconciliation

- Taggers run in parallel and cannot see each other. `item-refiner` fans in and reconciles overlaps, so each agent reports only its own dimension and never tries to compose the final result.
- `people-tagger`'s `@mention` is the canonical person source. Other agents (e.g. `agenda-detector`'s `targetPerson`) provide best-effort references that `item-refiner` overrides with the people-tagger spelling.
- Phase B composers read the fanned-in Phase A JSON from `.llm/gtd/refinement/$ITEM_ID.json` (and the destination-augmented `.llm/gtd/refinement/$ITEM_ID-with-dest.json`), not the live item alone.

## Naming judgment

When any dimension turns a written name into an `@mention`, follow `${CLAUDE_PLUGIN_ROOT}/skills/refinement-text-rules.md`: match on full name plus context, never first-name-alone, and leave a name plain when unsure.
