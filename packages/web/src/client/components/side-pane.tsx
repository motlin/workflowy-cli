import type {ReactNode} from "react";
import {useMemo} from "react";
import {MAIN_PANE_ID, SIDE_PANE_ID} from "../pane-ids.js";
import {useOutlineStore} from "../stores/outline.js";
import {FaIcon} from "./fa-icons.js";
import {IconButton} from "./icon-button.js";
import {OutlineTree} from "./outline-tree.js";
import {PANE_HEADER_ACTIVE_BORDER, PaneContext, paneActivation} from "./pane-context.js";

/**
 * The main outline's pane: a `display: contents` wrapper around its header and outline, so the fixed header and
 * document-scrolled outline lay out as before. It is the active pane (header border tinted) only while a side pane is
 * open and the main outline last saw a pointerdown or focusin.
 */
export function MainPane({children}: {children: ReactNode}) {
	const isActive = useOutlineStore((state) => state.sidePane !== null && state.activePaneId === MAIN_PANE_ID);
	const setActivePane = useOutlineStore((state) => state.setActivePane);
	return (
		<div
			data-pane-id={MAIN_PANE_ID}
			data-pane-type="item-tree"
			data-pane-active={isActive ? "true" : "false"}
			className="main-pane group/pane contents"
			{...paneActivation(MAIN_PANE_ID, setActivePane)}
		>
			{children}
		</div>
	);
}

/**
 * Upstream's secondary item-tree pane (`[data-pane-id][data-pane-type=item-tree]`), opened by the top bar's
 * New pane button. It zooms independently of the main outline: its bullets zoom the pane, not the URL.
 * First slice: one pane, Home and Close pane in its header, no breadcrumbs, persistence or resizing yet.
 */
export function SidePane() {
	const sidePane = useOutlineStore((state) => state.sidePane);
	const zoomSidePane = useOutlineStore((state) => state.zoomSidePane);
	const closeSidePane = useOutlineStore((state) => state.closeSidePane);
	const isActive = useOutlineStore((state) => state.activePaneId === SIDE_PANE_ID);
	const setActivePane = useOutlineStore((state) => state.setActivePane);
	const pane = useMemo(() => ({id: SIDE_PANE_ID, zoom: zoomSidePane}), [zoomSidePane]);
	if (sidePane === null) {
		return null;
	}
	return (
		<div
			data-pane-id={SIDE_PANE_ID}
			data-pane-type="item-tree"
			data-pane-active={isActive ? "true" : "false"}
			className="side-pane group/pane relative box-border flex-none bg-primary flex flex-col"
			{...paneActivation(SIDE_PANE_ID, setActivePane)}
		>
			<div
				className={`wf-header header bg-primary wf-pane-header border-b border-solid border-primary ${PANE_HEADER_ACTIVE_BORDER} flex-shrink-0`}
			>
				<IconButton
					data-handbook="nav.home"
					onClick={() => {
						zoomSidePane(null);
					}}
					tooltip="Home"
				>
					<FaIcon icon="fal:house" />
				</IconButton>
				<div className="ml-auto flex self-stretch items-center gap-xs flex-shrink-0">
					<IconButton
						className="text-tertiary hover:text-on-surface flex-shrink-0"
						onClick={closeSidePane}
						tooltip="Close pane"
					>
						<FaIcon icon="fal:xmark" />
					</IconButton>
				</div>
			</div>
			<div className="side-pane-scroller vertical-scrollable-container">
				<PaneContext.Provider value={pane}>
					<OutlineTree parentId={sidePane.zoomedId} />
				</PaneContext.Provider>
			</div>
		</div>
	);
}
