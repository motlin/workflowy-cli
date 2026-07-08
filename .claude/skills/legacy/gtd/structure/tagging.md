---
name: gtd-tagging
description: GTD tagging conventions for Workflowy. Use this skill when creating people, projects, or organizing actions with contexts.
---

# GTD Tagging Conventions

This skill defines the tagging system for GTD in Workflowy, based on David Allen's Getting Things Done methodology.

## Core Principles

- **Tags go in node text**, NOT in Workflowy notes (notes aren't searchable)
- **Natural language placement** - embed tags where they naturally appear in the sentence
- **Multiple tags encouraged** - e.g., `#call #home` for a call to make from home
- **Location/time tags are primary** - these are most useful for filtering what to do next

## Tag Formats

| Type         | Format          | Purpose                                           |
| ------------ | --------------- | ------------------------------------------------- |
| **People**   | `@Name`         | Agenda items - things to discuss with this person |
| **Projects** | `#project-name` | Link actions to their parent project              |
| **Location** | `#location`     | Where the action can be done                      |
| **Mode**     | `#mode`         | How the action is performed (tool/method)         |

## Tag Vocabulary

### Location Tags (Primary)

| Tag         | When to use             |
| ----------- | ----------------------- |
| `#home`     | Must be at home         |
| `#work`     | Must be at workplace    |
| `#errands`  | While out and about     |
| `#anywhere` | Location doesn't matter |

### Mode Tags

| Tag         | When to use             |
| ----------- | ----------------------- |
| `#call`     | Make a phone call       |
| `#email`    | Send an email           |
| `#computer` | Needs a computer/device |
| `#read`     | Reading/review material |
| `#buy`      | Purchase something      |

### People Tags

Use `@Name` format with the person's name:

- `@Alice` - for person named Alice
- `@Bob` - for person named Bob

**Possessive Rule:**

Never use possessives directly after `@Name` tags in metadata or action items (e.g., `@Alice's mom`). The apostrophe breaks Workflowy's tag recognition because the tag boundary becomes ambiguous.

- **Metadata / action items**: Reword to avoid possessives. Use "of @Name" or restructure the sentence.
    - Wrong: `@Alice's mom`
    - Right: `mom of @Alice`
    - Wrong: `@Bob's birthday presents`
    - Right: `birthday presents for @Bob`
- **Calendar narrative text**: Possessives are acceptable to keep natural wording (e.g., `@Bob's birthday party`). Calendar entries prioritize readability over strict tag hygiene.

### Project Tags

Use `#project-name` format, typically lowercase with hyphens:

- `#kitchen-renovation`
- `#quarterly-report`
- `#birthday-party-alice`

## Workflowy Formatting

### Coloring

Workflowy supports colored text, but **colors cannot be set via the API**. Coloring must be done manually in the Workflowy UI.

Available colors: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `sky`, `teal`, `lime`, `gray`

**@ mentions are auto-colored by Workflowy.** When a person exists in the 👥 People metadata with a colored background on their name, Workflowy's UI automatically renders all `@Name` mentions throughout the workspace with that same color. Just write `@PersonName` as plain text everywhere — never wrap mentions in `<span>` tags.

```
✅ Correct: Went to dinner with @AliceSmith and @BobJones
❌ Wrong:   Went to dinner with <span class="colored bc-purple">@AliceSmith</span>
```

**People coloring by relationship (applied manually in the UI):**

| Relationship  | Background Color | Group            |
| ------------- | ---------------- | ---------------- |
| Family        | green            | 👨‍👩‍👧‍👦 Family        |
| Colleagues    | blue             | 👔 Work          |
| Friends       | purple           | 🤝 Friends       |
| Professionals | blue             | 👤 Professionals |

### Links (Mirrors)

Workflowy supports linking to other nodes using HTML anchors. Links appear with an arrow indicator (↗️) and clicking them navigates to the target node.

**Format:**

```html
<a href="https://workflowy.com/#/SHORT_ID">Display Text</a>
```

**Use cases:**

- 📁 Projects registry: Link to the actual project node
- People entries: Link to related items or agenda
- Cross-references between related nodes

**Example - Project registry with link:**

```
Metadata > 📁 Projects > Personal 📁 Projects
  └─ ↗️ 🎂 Birthday party for Alice #birthday-party-alice  (link to actual project)
      └─ Status: active
      └─ Default contexts: #home
      └─ People: @Alice
```

**Creating a link:**

- Find the target node's URL (e.g., `https://workflowy.com/#/abc123def456`)
- Extract the short ID from the URL (the part after `#/`)
- Create the anchor tag:

```bash
./bin/run.js node create --parent-path "Metadata,📁 Projects,Personal 📁 Projects" \
  --name '<a href="https://workflowy.com/#/abc123def456">Project Title #project-tag</a>'
```

### People Naming Conventions

Format names based on relationship type:

| Relationship   | Format              | Color (applied in UI) | Group      | Example                    |
| -------------- | ------------------- | --------------------- | ---------- | -------------------------- |
| **Family**     | First name only     | green                 | 👨‍👩‍👧‍👦 Family  | `@Alice`, `@Bob`           |
| **Colleagues** | CamelCase full name | blue                  | 👔 Work    | `@AliceBrown`, `@BobSmith` |
| **Friends**    | CamelCase full name | purple                | 🤝 Friends | `@CharlieDavis`            |

**For duplicate first names:** Use CamelCase to disambiguate (e.g., `@AliceBrown`, `@AliceJones`)

## Natural Language Examples

**Good (natural placement):**

```
#call @Alice about the #kitchen-renovation timeline #home
Ask @Bob to review #quarterly-report #work
#buy new drill for #kitchen-renovation #errands
```

**Avoid (grouped at end):**

```
Call Alice about timeline @Alice #call #kitchen-renovation #home
```

## Retroactively Tagging Existing Entries

When adding tags to existing journal/calendar entries, **replace the word in-place** rather than appending tags at the end.

**Scenario:** Adding #pickleball tag to an existing calendar entry.

**Wrong (appending at end):**

```
Before: Lost 3 games of pickleball in a row.
After:  Lost 3 games of pickleball in a row. #pickleball
```

**Correct (inline replacement):**

```
Before: Lost 3 games of pickleball in a row.
After:  Lost 3 games of #pickleball in a row.
```

**Multiple tags - replace each word where it appears:**

```
Before: Played pickleball in the morning, then fed the sourdough starter.
After:  Played #pickleball in the morning, then fed the #sourdough starter.
```

**Why inline?** Tags are searchable in Workflowy. Inline placement keeps the text readable and makes the tag contextually meaningful rather than feeling like metadata tacked on at the end.

## Creating a Person

When a new person is mentioned during inbox processing:

### Create Person in Metadata

Create the node with plain `@Name` text. The API cannot set colors.

```bash
# Colleague (CamelCase)
./bin/run.js node create --parent-path "Metadata,👥 People,👔 Work" --name '@AliceBrown'

# Family (first name)
./bin/run.js node create --parent-path "Metadata,👥 People,👨‍👩‍👧‍👦 Family" --name '@Bob'

# Friend (CamelCase)
./bin/run.js node create --parent-path "Metadata,👥 People,🤝 Friends" --name '@CharlieDavis'
```

After creating the node, tell the user to apply the appropriate background color in the Workflowy UI (green for family, blue for work, purple for friends). This enables auto-coloring of all `@Name` mentions throughout the workspace.

### Add Context as Child Nodes

```bash
./bin/run.js node create --parent-path "Metadata,👥 People,👔 Work,@AliceBrown" --name "Full name: Alice Brown"
./bin/run.js node create --parent-path "Metadata,👥 People,👔 Work,@AliceBrown" --name "Relationship: colleague"
```

### Result Structure

```
Metadata > 👥 People > 👔 Work > @AliceBrown (color applied in UI)
  └─ Full name: Alice Brown
  └─ Relationship: colleague
```

Note: The person's context (Work, Family, Friends) is captured by which group they're nested under, so no separate "Context:" child node is needed.

## Creating a Project

When a multi-step outcome is identified:

### Create Project in Projects List

```bash
./bin/run.js node create --parent-path "📁 Projects" --name "🎂 Birthday party for Alice #birthday-party-alice"
# Output: Created node with short_id abc123def456
```

### Register Project in 📁 Projects

Create a link node in the registry with metadata children:

```bash
# Create link node (using short_id from the project creation above)
./bin/run.js node create --parent-path "Metadata,📁 Projects,Personal 📁 Projects" \
  --name '<a href="https://workflowy.com/#/abc123def456">🎂 Birthday party for Alice #birthday-party-alice</a>'

# Add metadata children
./bin/run.js node create --parent-path "Metadata,📁 Projects,Personal 📁 Projects,🎂 Birthday party for Alice #birthday-party-alice" \
  --name "Status: active"
./bin/run.js node create --parent-path "Metadata,📁 Projects,Personal 📁 Projects,🎂 Birthday party for Alice #birthday-party-alice" \
  --name "Default contexts: #home"
./bin/run.js node create --parent-path "Metadata,📁 Projects,Personal 📁 Projects,🎂 Birthday party for Alice #birthday-party-alice" \
  --name "People: @Alice"
```

### Create Initial Next Action

Every project needs at least one next action:

```bash
./bin/run.js node create --parent-path "☑️ Next Actions" --name "#call @Bob to get schedule from @Alice #birthday-party-alice #home"
```

### Result Structure

**In Projects:**

```
Personal > 📁 Projects > 🎂 Birthday party for Alice #birthday-party-alice
```

**In 📁 Projects registry:**

```
Metadata > 📁 Projects > Personal 📁 Projects
  └─ ↗️ 🎂 Birthday party for Alice #birthday-party-alice (link to project)
      └─ Status: active
      └─ Default contexts: #home
      └─ People: @Alice
```

**In Next Actions:**

```
Personal > ☑️ Next (Personal) > #call @Bob to get schedule from @Alice #birthday-party-alice #home
```

## Tagging an Existing Item

When moving an item from Inbox to Next Actions, add relevant tags:

### Determine Tags Needed

- **Location**: Where can this be done? (`#home`, `#work`, `#errands`, `#anywhere`)
- **Mode**: How is it done? (`#call`, `#email`, `#computer`, `#read`)
- **People**: Who's involved? (`@Alice`, `@Bob`)
- **Project**: Part of a larger outcome? (`#birthday-party-alice`)

### Update Node with Tags

```bash
./bin/run.js node update --id <node-id> --name "#call venue to confirm reservation #birthday-party-alice #work"
```

### Move to Appropriate List

```bash
./bin/run.js node move --node-id <node-id> --parent-path "☑️ Next Actions"
```

## Searching by Tag

Find all items with a specific tag:

```bash
./bin/run.js node search --query "@Alice"
./bin/run.js node search --query "#birthday-party-alice"
./bin/run.js node search --query "#home"
```

## Weekly Review: Tag Hygiene

During weekly review, check:

- **Orphaned tags**: Projects completed but tag still in use
- **Missing project tags**: Actions that should link to a project
- **Stale person tags**: People no longer active in your system
- **Missing contexts**: Actions without location tags

## Related Skills

- **gtd:create-person** - Person creation workflow
- **gtd:create-project** - Project creation workflow
- **gtd:create-hobby** - Hobby registry pattern
- **refine-journal** - Retroactive tagging and emoji annotation of journal entries
