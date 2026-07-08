---
description: UI Diff Deep-Dive: Production vs Local
---

# UI Diff Deep-Dive: Production vs Local

Compare UI components between production workflowy.com and localhost:5173 using Chrome DevTools MCP.

## Goal: Exact Replication

**Our goal is pixel-perfect replication of Workflowy, including CSS class names.**

Production Workflowy is the source of truth. When in doubt:

- Use the same CSS class names as production
- Use the same DOM structure as production
- Use the same CSS property values as production
- Match their CSS variables (--wf-\*, etc.)

This is not "inspired by" - this is an exact clone for personal use.

## Prerequisites

Ensure both sites are open in Chrome:

- Tab 1: `http://localhost:5173` (local replica)
- Tab 2: `https://workflowy.com` (production)

## Workflow

### Select Widget Category

Use AskUserQuestion to let user pick which widget category to analyze:

- **Node row** - bullet, toggle, text, spacing
- **Top bar** - navigation, breadcrumbs, toolbar icons
- **Context menu** - three-dot menu, dropdown items
- **Sidebars** - left/right sidebar styling
- **Other** - user specifies

### Asset Gathering

Before analyzing specific widgets, capture the original CSS assets from production Workflowy. This preserves the original authoring structure rather than just computed values.

- **Extract all stylesheet URLs** using `mcp__chrome-devtools__evaluate_script`:

    ```javascript
    () => [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href);
    ```

- **Extract inline style blocks** using `mcp__chrome-devtools__evaluate_script`:

    ```javascript
    () => [...document.querySelectorAll('style')].map((s) => s.textContent);
    ```

- **Extract CSS custom properties from :root** using `mcp__chrome-devtools__evaluate_script`:

    ```javascript
    () => {
    	const root = document.documentElement;
    	const styles = getComputedStyle(root);
    	const props = {};
    	for (const prop of styles) {
    		if (prop.startsWith('--')) props[prop] = styles.getPropertyValue(prop);
    	}
    	return props;
    };
    ```

- **Save external CSS files** to `.llm/reference/css/` for offline reference:
    - Fetch each stylesheet URL using WebFetch
    - Write the content to `.llm/reference/css/{filename}.css`
    - Save inline styles to `.llm/reference/css/inline-styles.css`
    - Save CSS custom properties to `.llm/reference/css/custom-properties.json`

### For Each Widget

For each widget in the selected category:

- **Take accessibility snapshot** using `mcp__chrome-devtools__take_snapshot`
    - Shows DOM structure and element UIDs

- **Take screenshot** using `mcp__chrome-devtools__take_screenshot`
    - Visual reference for comparison

- **Extract raw HTML** using `mcp__chrome-devtools__evaluate_script`:

    ```javascript
    (el) => el.outerHTML;
    ```

    - Compare class names exactly
    - Compare DOM structure (nesting, siblings)
    - Compare data attributes

- **Extract applied CSS rules** using `mcp__chrome-devtools__evaluate_script`:

    ```javascript
    (el) => {
    	const sheets = [...document.styleSheets];
    	const rules = [];
    	sheets.forEach((sheet) => {
    		try {
    			[...sheet.cssRules].forEach((rule) => {
    				if (rule.selectorText && el.matches(rule.selectorText)) {
    					rules.push({selector: rule.selectorText, css: rule.cssText});
    				}
    			});
    		} catch (e) {}
    	});
    	return rules;
    };
    ```

- **Extract computed styles** using `mcp__chrome-devtools__evaluate_script`:

    ```javascript
    (el) => {
    	const s = getComputedStyle(el);
    	return {
    		// Box model
    		width: s.width,
    		height: s.height,
    		padding: s.padding,
    		margin: s.margin,
    		// Typography
    		fontSize: s.fontSize,
    		fontWeight: s.fontWeight,
    		lineHeight: s.lineHeight,
    		color: s.color,
    		// Layout
    		display: s.display,
    		position: s.position,
    		top: s.top,
    		left: s.left,
    		// Visual
    		backgroundColor: s.backgroundColor,
    		opacity: s.opacity,
    		borderRadius: s.borderRadius,
    	};
    };
    ```

- **Compare and document**:
    - HTML class names: production vs local
    - CSS rules: which selectors match
    - Computed values: pixel differences
    - DOM structure: nesting differences

### Prioritize Fixes

After analyzing all widgets in the category:

- Classify each difference as HIGH/MEDIUM/LOW priority
- HIGH: Visible to users, affects usability
- MEDIUM: Noticeable but minor
- LOW: Pixel-perfect polish

### Output as Tasks

Use the **markdown-tasks skill** to add findings as tasks to `.llm/todo.md`.

For each mismatch found, create a task like:

```markdown
- [ ] Fix {widget} class name: rename `.outline-node-content` → `.content`
- [ ] Fix {widget} padding: change `5px 4px 5px 0` → `4px 10px 0 0` in styles.css
- [ ] Fix {widget} DOM structure: wrap text in `.innerContentContainer`
```

Tasks should be:

- **Specific** - exact property, exact value, exact file
- **Self-contained** - can be done without re-investigating
- **Prioritized** - HIGH priority tasks first

After adding tasks, summarize what was found and how many tasks were created.

## Example: Full Widget Extraction

```javascript
// Extract everything about a widget
(el) => ({
	tagName: el.tagName,
	className: el.className,
	id: el.id,
	attributes: [...el.attributes].map((a) => ({name: a.name, value: a.value})),
	outerHTML: el.outerHTML,
	computedStyle: (() => {
		const s = getComputedStyle(el);
		return {
			width: s.width,
			height: s.height,
			padding: s.padding,
			margin: s.margin,
			fontSize: s.fontSize,
			lineHeight: s.lineHeight,
			display: s.display,
			position: s.position,
		};
	})(),
});
```

## Files Commonly Modified

- `packages/web/src/client/styles.css` - Main styles
- `packages/web/src/client/components/outline-node.tsx` - Node components
- `packages/web/src/client/components/top-bar.tsx` - Header
- `packages/web/src/client/components/breadcrumbs.tsx` - Navigation

## Tips

- Use `select_page` to switch between tabs
- Compare at same zoom level and viewport size
- Check both light and dark mode if applicable
- Look for CSS variable differences (--wf-\* properties)
