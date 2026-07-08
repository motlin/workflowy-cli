---
name: create-hobby
description: Create a new hobby entry in GTD Hobbies Registry. Use this skill when tracking interests, activities, or hobbies that may generate related projects and tasks.
---

# Create Hobby

This skill defines how to create a hobby entry in the GTD 🎮 Hobbies Registry. Hobby entries enable organizing interests that may spawn related projects and tasks.

## Registry Structure

The 🎮 Hobbies Registry has two subfolders:

```
Metadata > 🎮 Hobbies Registry
├── 📦 Archived     (inactive hobbies)
└── 🟢 Current      (active hobbies)
```

New hobbies go under `🟢 Current`. When a hobby becomes inactive, move it to `📦 Archived`.

## When to Create a Hobby

Create a hobby entry when:

- User explicitly asks to track a new hobby or interest
- During inbox processing when a recurring interest is identified
- When grouping related projects under a common theme

## Workflow Overview

```
- Choose hobby name and tag format
- Create node in Metadata > 🎮 Hobbies Registry > 🟢 Current
- Add description and related projects as children
```

## Choose Hobby Name Format

Hobbies follow this naming convention:

```
#hobby-tag
```

**Components:**

- **#hobby-tag**: Kebab-case tag for the hobby (e.g., `#woodworking`, `#photography`, `#running`)

**Examples:**

- `#woodworking`
- `#photography`
- `#home-automation`
- `#language-learning`

## Create Hobby Node

Create the hobby entry under `🟢 Current`:

```bash
./bin/run.js node create --parent-path "Metadata,🎮 Hobbies Registry,🟢 Current" --name "#woodworking"
```

## Add Children

Add description and related projects as child nodes (use `--position bottom` to preserve order):

```bash
# Description (required)
./bin/run.js node create --parent-path "Metadata,🎮 Hobbies Registry,🟢 Current,#woodworking" --name "Description: Building furniture and home projects with wood" --position bottom

# Related projects (optional, add as discovered)
./bin/run.js node create --parent-path "Metadata,🎮 Hobbies Registry,🟢 Current,#woodworking" --name '<a href="https://workflowy.com/#/SHORT_ID">Build Bookshelf #build-bookshelf</a>' --position bottom
```

## Complete Example

Creating a new hobby "Photography":

```bash
# Create hobby node
./bin/run.js node create --parent-path "Metadata,🎮 Hobbies Registry,🟢 Current" --name "#photography"

# Add children
./bin/run.js node create --parent-path "Metadata,🎮 Hobbies Registry,🟢 Current,#photography" --name "Description: Landscape and street photography, focus on natural light" --position bottom

# Add related project links as they exist
./bin/run.js node create --parent-path "Metadata,🎮 Hobbies Registry,🟢 Current,#photography" --name '<a href="https://workflowy.com/#/abc123def456">Photo Walk Series #photo-walk-series</a>' --position bottom
```

### Result Structure

```
Metadata > 🎮 Hobbies Registry > 🟢 Current > #photography
  - Description: Landscape and street photography, focus on natural light
  - Photo Walk Series #photo-walk-series (link to project)
```

## Registry Entry Format

Each hobby entry has:

| Child          | Required | Description                             |
| -------------- | -------- | --------------------------------------- |
| `Description:` | Yes      | Brief description of the hobby/interest |
| Project links  | No       | Workflowy links to related projects     |

## Related Skills

- **gtd:create-project** - Projects linked to hobbies
- **gtd:create-person** - Similar registry pattern
