---
name: refinement-text-rules
description: 'Cross-cutting rules for any pass that rewrites the visible text of a Workflowy node — decoding stray HTML entities in prose, and the judgment (full name plus context, never first-name-alone) required before turning a written name into an @mention. Load in every text-refinement pass (journal, #exercise, inbox refinement, scanner-authored entries) to avoid mis-attributing tags.'
---

# Refinement text rules

Shared rules for any pass that rewrites the human-readable text of a node. These are independent of what is being tagged (people, hobbies, media) — apply them in every refinement pass.

## Trim surrounding whitespace

The Workflowy mobile UI leaves a trailing space on most nodes, and pasting leaves stray leading space — so a large share of nodes carry invisible edge whitespace. Whenever you compose an `after`/`composedText` for a node, **strip leading and trailing whitespace and collapse any internal run of spaces to one.**

- A node whose _only_ flaw is leading/trailing whitespace still warrants a fix — stage the trimmed text as its own proposal rather than skipping it.
- Trim the visible text, not Workflowy markup: leave the internal structure of `<a …>` / `<time …>` elements alone; only strip whitespace at the very start/end of the whole name and collapse double-spaces in prose.
- Never treat trailing/leading whitespace as meaningful — it never is.

## Clean up stray HTML entities

Workflowy stores node text as HTML, but ordinary prose does not need entity-encoded punctuation. CLI quirks and pasting sometimes leave literal entities in the visible text. Whenever you refine a node, decode stray entities in the prose a reader sees:

- `&quot;` → `"`
- `&amp;` → `&`
- `&lt;` / `&gt;` → `<` / `>` only when they are literal punctuation, not markup

Leave entities that are structurally required inside Workflowy HTML — attribute values in `<a href="…">` and `<time …>` — untouched. Only the visible prose gets cleaned.

## Normalize basic capitalization

Refined journal text should read as proper sentences, even when the original entry was typed casually. Whenever you compose an `after` value, capitalize:

- The first visible word of the entry, including the word immediately after a leading emoji (`🚗 Drove home`, not `🚗 drove home`).
- The first word after sentence-ending punctuation.
- Clear proper nouns and initialisms (`New York`, `PDF`, known place names, known product names).

Do not title-case the whole entry, and do not change ordinary mid-sentence verbs or casual phrasing. For example, `@Alice and I drove` keeps `drove` lowercase because it is a mid-sentence verb, not a sentence start or proper noun.

## Emoji selection reflects who did it

A leading emoji names the **actor**, not just the topic. The same activity gets a different emoji depending on who performed it — the user doing a chore, a family member doing it, and a hired service doing it are three different entries, and collapsing them to one topical emoji loses the distinction the journal is recording.

- The user (or the household) performed it → an emoji for the action itself.
- A hired service or vendor performed it → an emoji that reads as service/vendor work, not as the user's own effort.
- Someone else in the household performed it → prefer an emoji that reads as that person's activity.

When the entry does not say who acted, do not guess — stage the emoji as a ⚠️ ambiguity with contextual options rather than picking one that implies an actor.

Household shorthand — the terms that decide which reading applies — lives in the gitignored `.llm/gtd/journal-vocabulary.md`, alongside the voice-to-text mishearing table. Read that file when refining journal entries. Never copy its contents into `plugins/`; this repo's plugin files stay free of personal data.

## Re-tagging a name is a judgment call, not a script

Turning a written name into an `@mention` cannot be fully mechanized. The recurring failure is matching on the **first name alone** and attaching a tracked person, when the surrounding **surname or context** points to someone — or something — else:

- Two unrelated people can share a common first name.
- A first name can also belong to a public figure, a business, a venue, or an event — none of which resolve to a personal contact. (Public figures are often easy to spot; two ordinary people with the same first name are the harder, more dangerous case.)

So evaluate **every** candidate tag on its own, using the full name and the surrounding text — never the first name in isolation:

- If the surname or context does not match the tracked person, do **not** apply that person's tag. Leave the name as plain text (or stage a ⚠️ for the user).
- If a generic role word ("parents", "kids", "the girls") is part of a proper-noun event or place name, it is not a relational reference — do not substitute people.
- If a tag already contains the surname and the surname repeats as the next word, the trailing word is an orphan — drop it: `@AliceBrown Brown` → `@AliceBrown`.

### Resolve names mentioned together as a group, not one at a time

When two or more first names appear together in one entry ("it was also Alice and Bob", "we went with Carol and Dave"), they are usually a couple, a family, or a household — so resolve them **jointly**, not independently. Independent resolution produces mismatched pairs.
