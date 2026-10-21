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
