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
		branch && !state.expanded && "collapsed",
		state.isZoomRoot && "selected root",
		state.highlighted && "highlighted",
		state.addedToSelection && "addedToSelection",
		state.layoutClass,
		state.slidingUp && "completing-slide-up",
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
