---
name: create-project
description: Create a new project in GTD system. Use this skill when a multi-step outcome needs to be tracked as a project with registration in Metadata > 📁 Projects.
---

# Create Project

This skill defines how to create a project in the GTD system. Projects are multi-step outcomes that require tracking. Each project is created in a Projects list AND registered in `Metadata > 📁 Projects > [Domain] 📁 Projects`.

## When to Create a Project

Create a project when:

- User explicitly asks to create a new project
- During inbox processing when a multi-step outcome is identified
- Promoting a Someday item to an active project

## Workflow Overview

```
- Determine domain (Personal/Work)
- Choose project emoji and name
- Create project tag (#kebab-case)
- Create project node in [Domain] > 📁 Projects
- Register in Metadata > 📁 Projects > [Domain] 📁 Projects
```

## Determine Domain

Ask the user which domain applies:

| Domain       | Project List Path | Registry Path                               |
| ------------ | ----------------- | ------------------------------------------- |
| **Personal** | `📁 Projects`     | `Metadata,📁 Projects,Personal 📁 Projects` |
| **Work**     | `📁 Projects`     | `Metadata,📁 Projects,Work 📁 Projects`     |

## Choose Project Name Format

Projects follow this naming convention:

```
[emoji] Project Name #project-tag
```

**Components:**

- **emoji**: Single emoji representing the project theme
- **Project Name**: Human-readable title (title case)
- **#project-tag**: Kebab-case tag for linking actions to this project

**Examples:**

- `Kitchen Renovation #kitchen-renovation`
- `Quarterly Report #quarterly-report`
- `Birthday party for Alice #birthday-party-alice`

## Create Project Node

Create the project in the appropriate Projects list:

### Personal Project

```bash
./bin/run.js node create --parent-path "📁 Projects" --name "Kitchen Renovation #kitchen-renovation"
```

### Work Project

```bash
./bin/run.js node create --parent-path "📁 Projects" --name "Quarterly Report #quarterly-report"
```

**Capture the created node's ID and short_id** from the command output - you will need these for the registry link.

## Register in 📁 Projects

Projects are registered in `Metadata > 📁 Projects` under the appropriate domain folder. Each entry is a **link node** pointing to the actual project, with child metadata.

### Create registry entry (link node)

The entry itself is a link to the project node created above. Use the short_id from that step:

```bash
# Personal project
./bin/run.js node create --parent-path "Metadata,📁 Projects,Personal 📁 Projects" --name '<a href="https://workflowy.com/#/SHORT_ID">Kitchen Renovation #kitchen-renovation</a>'

# Work project
./bin/run.js node create --parent-path "Metadata,📁 Projects,Work 📁 Projects" --name '<a href="https://workflowy.com/#/SHORT_ID">Quarterly Report #quarterly-report</a>'
```

### Add metadata children

After creating the link node, add metadata as children. Use `--position bottom` to preserve order:

```bash
# Status (required) - values: active, on-hold, completed
./bin/run.js node create --parent-path "Metadata,📁 Projects,Personal 📁 Projects,Kitchen Renovation #kitchen-renovation" --name "Status: active" --position bottom
```

### Optional metadata children

```bash
# Default contexts - context tags for this project's actions
./bin/run.js node create --parent-path "Metadata,📁 Projects,Personal 📁 Projects,Kitchen Renovation #kitchen-renovation" --name "Default contexts: #home" --position bottom

# Tag - category or type tag
./bin/run.js node create --parent-path "Metadata,📁 Projects,Personal 📁 Projects,Kitchen Renovation #kitchen-renovation" --name "Tag: renovation" --position bottom

# People - people involved
./bin/run.js node create --parent-path "Metadata,📁 Projects,Personal 📁 Projects,Kitchen Renovation #kitchen-renovation" --name "People: @Alice, @Bob" --position bottom
```

## Complete Example

Creating a new personal project "Kitchen Renovation":

```bash
# Create project node
./bin/run.js node create --parent-path "📁 Projects" --name "Kitchen Renovation #kitchen-renovation"
# Output: Created node with id abc12345-..., short_id abc123def456

# Register in 📁 Projects (link node with metadata)
./bin/run.js node create --parent-path "Metadata,📁 Projects,Personal 📁 Projects" --name '<a href="https://workflowy.com/#/abc123def456">Kitchen Renovation #kitchen-renovation</a>'

./bin/run.js node create --parent-path "Metadata,📁 Projects,Personal 📁 Projects,Kitchen Renovation #kitchen-renovation" --name "Status: active" --position bottom

./bin/run.js node create --parent-path "Metadata,📁 Projects,Personal 📁 Projects,Kitchen Renovation #kitchen-renovation" --name "Default contexts: #home" --position bottom
```

### Result Structure

**In Projects list:**

```
Personal > 📁 Projects > Kitchen Renovation #kitchen-renovation
```

**In 📁 Projects registry:**

```
Metadata > 📁 Projects > Personal 📁 Projects
  └── Kitchen Renovation #kitchen-renovation (link to project)
      ├── Status: active
      └── Default contexts: #home
```

## Registry Entry Format

Each registry entry is a **link node** (the node itself links to the actual project), with children for metadata:

| Child               | Required | Description                                            |
| ------------------- | -------- | ------------------------------------------------------ |
| `Status:`           | Yes      | `active`, `on-hold`, `completed`                       |
| `Default contexts:` | No       | Common context tags for actions (`#home`, `#computer`) |
| `Tag:`              | No       | Category or type tag for the project                   |
| `People:`           | No       | People involved (`@Alice, @Bob`)                       |

**Note:** The project name and link are embedded in the entry node itself (e.g., `<a href="...">Kitchen Renovation #kitchen-renovation</a>`), so no separate "Full name" or "Link" children are needed.

## Project Status Values

| Status      | When to use                   |
| ----------- | ----------------------------- |
| `active`    | Currently being worked on     |
| `on-hold`   | Paused, not currently active  |
| `completed` | Finished (consider archiving) |

## Related Skills

- **gtd:create-person** - Similar pattern for creating people
- **gtd:create-hobby** - Similar registry pattern
