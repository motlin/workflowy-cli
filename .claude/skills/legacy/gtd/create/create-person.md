---
name: create-person
description: Create a new person entry in GTD People list. Use this skill when an unknown person needs to be tracked for agenda items and relationship context.
---

# Create Person

This skill defines how to create a person entry in the GTD People list. People entries enable tracking agenda items (things to discuss with this person) and relationship context.

## When to Create a Person

Create a person entry when:

- User explicitly asks to track a new person
- During inbox processing when a person mention needs to be formalized
- During calendar people-tagging when an untracked person is identified

## Workflow Overview

```
- Determine category (Work/Family/Friends)
- Determine name format (first name vs CamelCase)
- Create node in Metadata > 👥 People > [Category]
- Optionally add context as child nodes
```

## Determine Category

Ask the user which category applies:

| Category    | Emoji | Path                            | When to use                  |
| ----------- | ----- | ------------------------------- | ---------------------------- |
| **Work**    | 👔    | `Metadata,👥 People,👔 Work`    | Colleagues, clients, vendors |
| **Family**  | 👨‍👩‍👧‍👦    | `Metadata,👥 People,👨‍👩‍👧‍👦 Family`  | Family members, relatives    |
| **Friends** | 🤝    | `Metadata,👥 People,🤝 Friends` | Friends, acquaintances       |

## Determine Name Format

The name format depends on the category:

| Category    | Format              | Example         |
| ----------- | ------------------- | --------------- |
| **Family**  | First name only     | `@Alice`        |
| **Work**    | CamelCase full name | `@AliceBrown`   |
| **Friends** | CamelCase full name | `@CharlieDavis` |

**For duplicate first names:** Use CamelCase to disambiguate even in Family (e.g., `@AliceBrown`, `@AliceJones`)

## Create Person Node

Create the person node with plain `@Name` text:

```bash
# Work (CamelCase)
./bin/run.js node create --parent-path "Metadata,👥 People,👔 Work" --name '@AliceBrown'

# Family (first name)
./bin/run.js node create --parent-path "Metadata,👥 People,👨‍👩‍👧‍👦 Family" --name '@Bob'

# Friends (CamelCase)
./bin/run.js node create --parent-path "Metadata,👥 People,🤝 Friends" --name '@CharlieDavis'
```

> **Coloring:** Background colors on person entries (green for family, blue for work, purple for friends) must be applied manually in the Workflowy UI. The API cannot set node colors. After creating the node, tell the user to color it in the UI.

## Add Context (Optional)

Add child nodes with additional context about the person (use `--position bottom` to preserve order):

```bash
./bin/run.js node create --parent-path "Metadata,👥 People,👔 Work,@AliceBrown" --name "Full name: Alice Brown" --position bottom
./bin/run.js node create --parent-path "Metadata,👥 People,👔 Work,@AliceBrown" --name "Role: Product Manager" --position bottom
./bin/run.js node create --parent-path "Metadata,👥 People,👔 Work,@AliceBrown" --name "Company: Acme Corp" --position bottom
```

Common context fields:

| Field        | Example                      |
| ------------ | ---------------------------- |
| `Full name:` | Full name: Alice Brown       |
| `Role:`      | Role: Product Manager        |
| `Company:`   | Company: Acme Corp           |
| `Relation:`  | Relation: cousin             |
| `Met:`       | Met: 2024-06 at conference   |
| `Notes:`     | Notes: Prefers morning calls |

## Complete Example

Creating a new work colleague "Alice Brown":

```bash
# Create person node
./bin/run.js node create --parent-path "Metadata,👥 People,👔 Work" --name '@AliceBrown'

# Add context (optional, use --position bottom to preserve order)
./bin/run.js node create --parent-path "Metadata,👥 People,👔 Work,@AliceBrown" --name "Full name: Alice Brown" --position bottom
./bin/run.js node create --parent-path "Metadata,👥 People,👔 Work,@AliceBrown" --name "Role: Product Manager" --position bottom

# Tell the user to color the @AliceBrown node blue in the Workflowy UI
```

### Result Structure

```
Metadata > 👥 People > 👔 Work > @AliceBrown
  - Full name: Alice Brown
  - Role: Product Manager
```

Note: User must apply blue background color to `@AliceBrown` in the Workflowy UI for auto-coloring to work.

## Related Skills

- **gtd:create-project** - Similar pattern for creating projects
- **gtd:create-hobby** - Similar registry pattern
