---
name: refinement-text-rules
description: 'Cross-cutting rules for any pass that rewrites the visible text of a Workflowy node — decoding stray HTML entities in prose, the judgment (full name plus context, never first-name-alone) required before turning a written name into an @mention, the ban on writing search-coverage caveats ("not yet seen in", "no price found") into node text instead of the value, and the inverse rule for text that leaves Workflowy (notes the user will share, send, paste, or read aloud), which needs plain full names instead of @mentions. Load in every text-refinement pass (journal, #exercise, inbox refinement, scanner-authored entries) to avoid mis-attributing tags.'
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

The same restraint covers grammar, not just casing. A non-standard construction that recurs across entries is household voice — leave it exactly as written. Count the exact phrase across the journal before proposing any grammatical correction: more than one occurrence means it is deliberate and gets no change; a single occurrence that still reads deliberate goes to the user as a `⚠️` ambiguity rather than a silent rewrite. Recurring household terms are recorded in the gitignored `.llm/gtd/journal-vocabulary.md`; never copy one into `plugins/`.

## Remember explanations in the matching reference file

When the user explains an intentional phrase during refinement, classify what the explanation resolves before saving it:

- **People:** `.llm/gtd/people-disambiguation.md` is only for people's names, nicknames, homonyms, and name spellings. A homonym needs distinguishing context, not merely a list of people with that name.
- **Non-people terms:** household shorthand, intentional phrasing, and non-person voice-to-text mishearings belong in `.llm/gtd/journal-vocabulary.md`. Never put them in the people file, even if the phrase resembles a person's name.

An explanation alone is not permission to save a vocabulary entry. In the interactive apply walk, offer an explicit **Keep as written and add to journal-vocabulary.md** option alongside **Keep as written without saving vocabulary**. Show the exact term, proposed meaning or mishearing mapping, and `.llm/gtd/journal-vocabulary.md` destination in the question. If the explanation arrives through free text or "Other", ask this follow-up before persisting it. Use the active review's presentation policy. Only the save choice authorizes adding or updating that entry; reuse an existing matching entry instead of duplicating it. Prep may read these references but must leave new explanations for apply-time confirmation.

Both keep-as-written choices reject the proposed rewrite. Where a decline ledger is used, store only its rejection fields; never append the explanation, a rationale, or vocabulary metadata. Declining vocabulary persistence must not silently save the explanation in another file. These reference files are private runtime data: never copy their contents into tracked plugin prompts or examples.

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

## Record the value, never your search coverage

A node records a fact. It never records how hard you looked for the fact. The user reads the node months later, without this conversation, and "Registrar price not yet seen in card exports" tells them nothing about the price -- it only tells them which source one past session happened to check.

When a researched value is missing from the first source you tried:

- Go to the authoritative source before writing anything: the vendor's pricing page, the account dashboard, the registrar's own price list, the receipt. Card exports, email search, and cached notes are convenience sources, not the source of truth for a price or a date.
- Once you have the value, write the value: `Example Registrar: $12/yr`. The search that produced it stays in the conversation.
- If the value is still unknown after the authoritative source, either leave the field out or write the value you have with the `(?)` marker from the people-metadata skill (plain text, a space, then `(?)` -- for example `~$12/yr (?)`).

Never write any of these into a node name or note:

- "not yet seen in card exports" / "not in the exports"
- "no price found" / "price unknown, could not find"
- "could not confirm" / "unverified as of YYYY-MM-DD"
- "checked X, Y, Z -- nothing"

A node that would otherwise carry only a caveat should not be written at all. Report the gap to the user in the conversation, where it belongs, and let them decide whether to chase it.

## Content that leaves Workflowy

Every rule above assumes the text stays inside Workflowy, where `@mention` and `#tag` are live links. When the user signals the text is going somewhere else — "I'm going to share these notes", "this gets pasted into the doc", "send this to the team", "I'm reading this out" — that syntax turns into noise for a reader who has never seen the outline. Rewrite it as plain prose:

- Replace each `@mention` with the person's **plain full name**, first plus last: `@AliceBrown` becomes `Alice Brown`, and `@Alice` becomes `Alice Brown` — not `Alice`. A bare first name is exactly what an outside reader cannot resolve, so the surname matters more here than anywhere else. If the surname is not in the people metadata, ask for it rather than shipping the first name alone.
- Drop `#tags`. They classify the node for the user's own system and mean nothing to the reader. If a tag carried real information the reader needs, restate it in words.
- Replace `<time …>` elements with the date written out, and replace links to other Workflowy nodes with the text they name (or the fact they pointed to, if the reader cannot open the outline).

This is the inverse of the tagging rules, and both directions have to be applied deliberately. Inside Workflowy, a resolved name should become `@Alice`; on the way out, `@Alice` should become `Alice Brown`. Running only the tagging direction is the failure this section exists to prevent.
