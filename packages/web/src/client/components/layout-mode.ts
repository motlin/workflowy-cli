/**
 * Maps a node's `metadata.layoutMode` value (as carried on `node.data.layoutMode`)
 * to the `.project` CSS class Workflowy applies for that block layout, plus flags
 * the renderer needs.
 *
 * Workflowy's convention: the `.project` class equals the `layoutMode` value, with
 * two exceptions — headings map to `header{N}` and the default `bullets`/`bullet`
 * carries no class. Some surfaces emit `quote` vs `quote-block` and `p` vs
 * `paragraph`; both spellings are normalized here so persisted data and the in-app
 * layout menu agree.
 *
 * Styling lives in styles.css keyed on `.project.<class>`. See
 * `.llm/web/node-type-coverage.md` for the upstream capture.
 */
export interface LayoutModeRendering {
	/** Class appended to the node's `.project` element, or null for default bullets. */
	projectClass: string | null;
	/** True when the layout replaces the round bullet with a checkbox (to-do). */
	isTodo: boolean;
	/** True for full-width "multiline" blocks (code-block, quote-block). */
	isMultiline: boolean;
	/** True when the layout suppresses the bullet (headings, divider). */
	hidesBullet: boolean;
}

const HEADING_CLASS: Record<string, string> = {
	h1: 'header1',
	h2: 'header2',
	h3: 'header3',
};

/**
 * Resolve the rendering descriptor for a `layoutMode` value. Unknown or default
 * (`null`/`bullets`/`bullet`) values render as a plain bullet.
 */
export function resolveLayoutMode(layoutMode: string | null | undefined): LayoutModeRendering {
	const none: LayoutModeRendering = {
		projectClass: null,
		isTodo: false,
		isMultiline: false,
		hidesBullet: false,
	};

	if (!layoutMode || layoutMode === 'bullets' || layoutMode === 'bullet') {
		return none;
	}

	const heading = HEADING_CLASS[layoutMode];
	if (heading) {
		return {projectClass: heading, isTodo: false, isMultiline: false, hidesBullet: true};
	}

	if (layoutMode === 'todo') {
		return {projectClass: 'checkmark', isTodo: true, isMultiline: false, hidesBullet: false};
	}

	if (layoutMode === 'code-block') {
		return {projectClass: 'code-block', isTodo: false, isMultiline: true, hidesBullet: false};
	}

	if (layoutMode === 'quote' || layoutMode === 'quote-block') {
		return {projectClass: 'quote-block', isTodo: false, isMultiline: true, hidesBullet: false};
	}

	if (layoutMode === 'divider') {
		return {projectClass: 'divider', isTodo: false, isMultiline: false, hidesBullet: true};
	}

	if (layoutMode === 'numbered') {
		return {projectClass: 'numbered', isTodo: false, isMultiline: false, hidesBullet: false};
	}

	if (layoutMode === 'board') {
		return {projectClass: 'board', isTodo: false, isMultiline: false, hidesBullet: false};
	}

	if (layoutMode === 'paragraph' || layoutMode === 'p') {
		return {projectClass: 'paragraph', isTodo: false, isMultiline: false, hidesBullet: false};
	}

	return none;
}
