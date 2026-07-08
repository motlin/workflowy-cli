---
description: Conventions for person nodes under Metadata > 👥 People. Use when reading, creating, editing, or reordering people metadata — the category hierarchy, the one-fact-per-child rule, the emoji-prefixed field set and its canonical display order, relationship @mention links, native <time> date values, and the CLI/iMCP gotchas (full-UUID writes, 429 pacing, Apple Contacts address sync).
---

# People Metadata

People live under `Metadata > 👥 People`: Category (`👨‍👩‍👧‍👦 Family` / `🤝 Friends` / `👔 Work` / `👤 Professionals`) > optional surname/subgroup > `@Person` > field children. Put one fact per child node, and never in a node's note.

Surname subgroups hold no direct field or `📝` note; every field lives on a person. When a household shares a value like an address, copy it onto each resident rather than the subgroup, and put a family-wide provenance note on the head of household.

## Fields

Each fact is a child node named `<emoji> Label: value`. The table lists them in canonical display order, top to bottom. When scanning, match on the `Label:` text, since stragglers may lack the emoji; add the matching emoji when you create or fix a field.

| Emoji | Field | Notes |
| --- | --- | --- |
| `👥` | Relationship | see below |
| `📛` | Full / Real / English / Maiden name |  |
| `🏷️` | Alias / Nickname |  |
| `💼` | Role |  |
| `👔` | Team |  |
| `👶` | Date of birth / Estimated birth year | actual birth year |
| `🎂` | Birthday | next upcoming occurrence year |
| `💒` | Married on | wedding date, actual year; on both spouses |
| `💍` | Anniversary | next occurrence year; on both spouses |
| `🪦` | Date of death |  |
| `🕯️` | Yahrzeit | next occurrence |
| `📍` | Address | current home; keep the word "Address"; a second or seasonal home is just another `📍 Address:` |
| `🏢` | Work | office address; only for family/self, or a friend whose office you've been to |
| `🏠` | Old address | former home; wrap the whole node in `<s>…</s>` |
| `📞` | Phone | normalize US to `(xxx) xxx-xxxx` |
| `📧` | Email |  |
| `🔗` | LinkedIn / social |  |

The order groups identity, then life milestones (each base date followed by its recurring observance), then physical contact, then internet contact. To reorder, move each field to the bottom in this sequence (`node move --position bottom`); duplicate fields of one type end up adjacent on their own.

## Relationships

State only the connection: `friend of @Bob`, `son of @Alice and @Bob`. Skip descriptors like "mom". Mentions point one way toward the user: each person links to whoever is one step closer to them, never the reverse.

Keep each `@mention` as plain text and put a separate link glyph after it. Don't wrap the mention itself in the `<a>`; Workflowy styles `@mentions`, and wrapping strips that styling.

```text
👥 Relationship: friend of @Bob <a href="https://workflowy.com/#/<shortId>">↗</a>
```

Link every mention. The `shortId` is the last segment of the node's UUID.

## Dates

Write date values (`👶 🎂 💒 💍 🪦 🕯️`) as raw `<time>` HTML. The CLI does not convert `[YYYY-MM-DD]` bracket syntax; it stores that text literally. Don't zero-pad the month or day in the attributes.

```text
🎂 Birthday: <time startYear="2027" startMonth="5" startDay="27">Thu, May 27, 2027</time>
```

For an approximate or unconfirmed value, use plain text with no `<time>` and append a space followed by `(?)`.

## Editing

- Writes (`update`, `move`, `create --parent-id`) need the full UUID; short IDs return 404. Reads accept short IDs.
- Run `--force-refresh` before enumerating people for a bulk op. A stale cache silently omits recent nodes.
- Bulk update and move loops hit HTTP 429 around 150 rapid calls. Space them ~0.6s and retry only the failures.
- To detect a field, require a colon plus a word-boundary keyword (so `Greenworks` doesn't match `work`) and skip `📝` notes. Decide person vs subgroup by whether field-children outnumber person-children.

## Apple Contacts sync (iMCP)

- `contacts_update` `postalAddresses` replaces the whole set, so pass every address you want to keep.
- `contacts_search` is unreliable for current addresses: no recency, and the one address on a card may be stale. Trust phones over addresses, and verify against the user, recent email, or county records.
