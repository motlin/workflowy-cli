export interface ProjectClassState {
	hasChildren: boolean;
	expanded: boolean;
	completed: boolean;
	hasNote: boolean;
	noteFocused: boolean;
	isZoomRoot: boolean;
	hasMirrors: boolean;
	highlighted: boolean;
	addedToSelection: boolean;
	layoutClass?: string;
	/** Upstream's references root, the Backlinks section's row. */
	references?: boolean;
	/** The completed row is playing upstream's slideUp before it hides. */
	slidingUp?: boolean;
	/** The completed row was just revealed by showing completed and plays the slideDown. */
	slidingDown?: boolean;
	/** The row's `.children` is playing the expand slideDown. */
	animatingShowChildren?: boolean;
	/** Shift+Cmd+Up/Down just moved this row; upstream flashes it for 500ms. */
	moving?: boolean;
	/** A bullet drag's drop line sits inside this row, in its first child slot. */
	dragHoveredIn?: boolean;
	/** A bullet drag's drop line sits under this row. */
	dragHoveredAt?: boolean;
}

export interface NameClassState {
	focused?: boolean;
	isZoomRoot?: boolean;
	isMainRoot?: boolean;
	empty?: boolean;
	/** Something renders before the name, like a backlink's source crumbs. */
	withEmbedder?: boolean;
}

// Mirrors upstream's `.project` class order; layout classes come last.
export function projectClassName(state: ProjectClassState): string {
	const branch = state.hasChildren && !state.isZoomRoot;
	return [
		"font-custom project",
		state.references && "references",
		state.hasMirrors && "hasMirrors",
		!state.hasChildren && "task",
		state.completed && "done",
		(state.hasNote || state.noteFocused) && "noted",
		branch && state.expanded && "open",
		branch && state.expanded && state.animatingShowChildren && "animatingShowChildren",
		branch && !state.expanded && "collapsed",
		state.isZoomRoot && "selected root",
		state.highlighted && "highlighted",
		state.addedToSelection && "addedToSelection",
		state.moving && "moving",
		state.dragHoveredIn && "drag-hovered-in",
		state.dragHoveredAt && "drag-hovered-at",
		state.layoutClass,
		state.slidingUp && "completing-slide-up",
		state.slidingDown && "completed-slide-down",
	]
		.filter(Boolean)
		.join(" ");
}

// Mirrors upstream's `.name` class order.
export function nameClassName(state: NameClassState): string {
	return [
		"name",
		state.withEmbedder && "name--with-embedder",
		state.focused && "name--focused",
		state.isZoomRoot && "name--main",
		state.isMainRoot && "name--root",
		state.empty && "empty",
	]
		.filter(Boolean)
		.join(" ");
}
