import type {ReactNode} from "react";
import {useMemo} from "react";
import {useNavigateToToday} from "../hooks/use-navigate-to-today.js";
import {MAIN_PANE_ID, SIDE_PANE_ID} from "../pane-ids.js";
import {useOutlineStore} from "../stores/outline.js";
import {Breadcrumbs} from "./breadcrumbs.js";
import {FaIcon} from "./fa-icons.js";
import {HeaderMoreMenu} from "./header-more-menu.js";
import {IconButton} from "./icon-button.js";
import {OutlineTree} from "./outline-tree.js";
import {PANE_HEADER_ACTIVE_BORDER, PaneContext, paneActivation, scrollSidePaneToTop} from "./pane-context.js";
import {PaneSearchBox} from "./pane-search-box.js";
import {NewPaneIcon} from "./new-pane-icon.js";

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
 * Upstream's `pane-workspace-control` on the last pane: a New pane button at the header's top right. Upstream opens
 * a further pane on this pane's zoom; with one side pane locally, it opens a fresh side pane there instead.
 */
function PaneWorkspaceControl({zoomedId}: {zoomedId: string | null}) {
	const openSidePane = useOutlineStore((state) => state.openSidePane);
	return (
		<div className="pane-workspace-control box-content absolute top-0 right-0 flex h-[var(--wf-header-height)] w-[var(--pane-workspace-control-width)] items-center justify-center border-l border-b border-solid border-primary group-data-[pane-active=true]/pane:border-b-tint bg-primary">
			<IconButton
				onClick={() => {
					openSidePane(zoomedId);
				}}
				shortcut="⌃R"
				tooltip="New pane"
			>
				<NewPaneIcon />
			</IconButton>
		</div>
	);
}

interface SidePaneProps {
	onUndo: () => void;
	onRedo: () => void;
}

/**
 * Upstream's secondary item-tree pane (`[data-pane-id][data-pane-type=item-tree]`), opened by the top bar's
 * New pane button. It zooms independently of the main outline: its bullets zoom the pane, not the URL.
 * Its compact `.wf-pane-header` follows upstream's: Back/Forward through the pane's own history, breadcrumbs (whose
 * root crumb is Home) that zoom the pane, the compact search circle filtering only this pane, Today zooming the pane,
 * the kebab holding the compactable actions for the pane's zoom, and Close pane. As the last pane it carries the
 * New pane control at its top right.
 */
export function SidePane({onUndo, onRedo}: SidePaneProps) {
	const sidePane = useOutlineStore((state) => state.sidePane);
	const zoomSidePane = useOutlineStore((state) => state.zoomSidePane);
	const closeSidePane = useOutlineStore((state) => state.closeSidePane);
	const sidePaneBack = useOutlineStore((state) => state.sidePaneBack);
	const sidePaneForward = useOutlineStore((state) => state.sidePaneForward);
	const setSidePaneQuery = useOutlineStore((state) => state.setSidePaneQuery);
	const navigateToToday = useNavigateToToday(zoomSidePane);
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
				<div className="pagination">
					<IconButton
						data-handbook="nav.back"
						disabled={sidePane.backLocations.length === 0}
						onClick={sidePaneBack}
						tooltip="Back"
					>
						<FaIcon icon="fal:chevron-left" />
					</IconButton>
					{sidePane.forwardLocations.length > 0 && (
						<IconButton data-handbook="nav.forward" onClick={sidePaneForward} tooltip="Forward">
							<FaIcon icon="fal:chevron-right" />
						</IconButton>
					)}
				</div>
				<Breadcrumbs nodeId={sidePane.zoomedId} onNavigate={zoomSidePane} scrollToTop={scrollSidePaneToTop} />
				<div className="ml-auto flex self-stretch items-center gap-xs flex-shrink-0">
					<PaneSearchBox compact onCommit={setSidePaneQuery} query={sidePane.query} />
					{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- upstream wraps the Today IconButton in a bare clickable div; the IconButton handles keys */}
					<div onClick={() => void navigateToToday()}>
						<IconButton tooltip="Today">
							<FaIcon icon="fal:calendar-day" />
						</IconButton>
					</div>
					<HeaderMoreMenu
						anchorSelector={`[data-pane-id="${SIDE_PANE_ID}"] .gearMenu`}
						compact
						onRedo={onRedo}
						onUndo={onUndo}
						zoomedId={sidePane.zoomedId}
					/>
					<IconButton
						className="text-tertiary hover:text-on-surface flex-shrink-0"
						onClick={closeSidePane}
						tooltip="Close pane"
					>
						<FaIcon icon="fal:xmark" />
					</IconButton>
				</div>
			</div>
			<PaneWorkspaceControl zoomedId={sidePane.zoomedId} />
			<div className="side-pane-scroller vertical-scrollable-container">
				<PaneContext.Provider value={pane}>
					<OutlineTree parentId={sidePane.zoomedId} />
				</PaneContext.Provider>
			</div>
		</div>
	);
}
