export interface ShowZoomDeps {
	inSidePane: boolean;
	zoomSidePane: (id: string | null) => void;
	goToNode: (id: string | null) => void;
	scrollToTop: (pane: "main" | "side") => void;
}

/** Show `destination` in the active pane: zoom the side pane while it is active, else navigate the main outline. */
export function showZoom(destination: string | null, scrollTop: boolean, deps: ShowZoomDeps): void {
	if (deps.inSidePane) {
		deps.zoomSidePane(destination);
	} else {
		deps.goToNode(destination);
	}
	if (scrollTop) {
		deps.scrollToTop(deps.inSidePane ? "side" : "main");
	}
}

/**
 * The root an outline renders: the requested zoom, except while its children are still loading, when the previously
 * shown root (Home is null) stays on screen so the swap lands in one frame instead of flashing "Loading...". With
 * nothing shown yet (`undefined`) the requested root renders its loading state.
 */
export function outlineRootToShow(
	requested: string | null,
	loading: boolean,
	lastShown: string | null | undefined,
): string | null {
	return loading && lastShown !== undefined ? lastShown : requested;
}
