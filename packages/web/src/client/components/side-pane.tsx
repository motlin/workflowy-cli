import type {ReactNode} from "react";
import {useMemo} from "react";
import {useNavigateToToday} from "../hooks/use-navigate-to-today.js";
import {MAIN_PANE_ID} from "../pane-ids.js";
import type {ItemTreePane} from "../pane-ids.js";
import {useOutlineStore} from "../stores/outline.js";
import {Breadcrumbs} from "./breadcrumbs.js";
import {FaIcon} from "./fa-icons.js";
import {HeaderMoreMenu} from "./header-more-menu.js";
import {IconButton} from "./icon-button.js";
import {OutlineTree} from "./outline-tree.js";
import {PANE_HEADER_ACTIVE_BORDER, PaneContext, paneActivation, scrollPaneToTop} from "./pane-context.js";
import {PaneSearchBox} from "./pane-search-box.js";
import {NewPaneIcon} from "./new-pane-icon.js";

/**
 * The main outline's pane: a `display: contents` wrapper around its header and outline, so the fixed header and
 * document-scrolled outline lay out as before. It is the active pane (header border tinted) only while a pane is open
 * and the main outline last saw a pointerdown or focusin.
 */
export function MainPane({children}: {children: ReactNode}) {
	const isActive = useOutlineStore((state) => state.panes.length > 0 && state.activePaneId === MAIN_PANE_ID);
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
 * Upstream's `pane-workspace-control` on the last pane: a New pane button at the header's top right that opens another
 * pane on this pane's zoom after it and focuses it.
 */
function PaneWorkspaceControl({paneId, zoomedId}: {paneId: string; zoomedId: string | null}) {
	const openPane = useOutlineStore((state) => state.openPane);
	return (
		<div className="pane-workspace-control box-content absolute top-0 right-0 flex h-[var(--wf-header-height)] w-[var(--pane-workspace-control-width)] items-center justify-center border-l border-b border-solid border-primary group-data-[pane-active=true]/pane:border-b-tint bg-primary">
			<IconButton
				onClick={() => {
					openPane(zoomedId, {sourcePaneId: paneId});
				}}
				shortcut="⌃R"
				tooltip="New pane"
			>
				<NewPaneIcon />
			</IconButton>
		</div>
	);
}

interface PaneActions {
	onUndo: () => void;
	onRedo: () => void;
}

interface SidePaneProps extends PaneActions {
	pane: ItemTreePane;
	/** The rightmost pane carries upstream's pane-workspace-control (New pane). */
	isLast: boolean;
}

/**
 * One of upstream's secondary item-tree panes (`[data-pane-id][data-pane-type=item-tree]`), opened by New pane or
 * Open in Pane. It zooms independently of the main outline and the other panes: its bullets zoom the pane, not the URL.
 * Its compact `.wf-pane-header` follows upstream's: Back/Forward through the pane's own history, breadcrumbs (whose
 * root crumb is Home) that zoom the pane, the compact search circle filtering only this pane, Today zooming the pane,
 * the kebab holding the compactable actions for the pane's zoom, and Close pane. The last pane carries the New pane
 * control at its top right.
 */
function SidePane({pane, isLast, onUndo, onRedo}: SidePaneProps) {
	const {id} = pane;
	const zoomPane = useOutlineStore((state) => state.zoomPane);
	const closePane = useOutlineStore((state) => state.closePane);
	const paneBack = useOutlineStore((state) => state.paneBack);
	const paneForward = useOutlineStore((state) => state.paneForward);
	const setPaneQuery = useOutlineStore((state) => state.setPaneQuery);
	const isActive = useOutlineStore((state) => state.activePaneId === id);
	const setActivePane = useOutlineStore((state) => state.setActivePane);
	const context = useMemo(
		() => ({
			id,
			zoom: (zoomedId: string | null) => {
				zoomPane(id, zoomedId);
			},
		}),
		[id, zoomPane],
	);
	const navigateToToday = useNavigateToToday(context.zoom);
	return (
		<div
			data-pane-id={id}
			data-pane-type="item-tree"
			data-pane-active={isActive ? "true" : "false"}
			className="side-pane group/pane relative box-border flex-none bg-primary flex flex-col"
			{...paneActivation(id, setActivePane)}
		>
			<div
				className={`wf-header header bg-primary wf-pane-header border-b border-solid border-primary ${PANE_HEADER_ACTIVE_BORDER} flex-shrink-0`}
			>
				<div className="pagination">
					<IconButton
						data-handbook="nav.back"
						disabled={pane.backLocations.length === 0}
						onClick={() => {
							paneBack(id);
						}}
						tooltip="Back"
					>
						<FaIcon icon="fal:chevron-left" />
					</IconButton>
					{pane.forwardLocations.length > 0 && (
						<IconButton
							data-handbook="nav.forward"
							onClick={() => {
								paneForward(id);
							}}
							tooltip="Forward"
						>
							<FaIcon icon="fal:chevron-right" />
						</IconButton>
					)}
				</div>
				<Breadcrumbs
					nodeId={pane.zoomedId}
					onNavigate={context.zoom}
					scrollToTop={() => {
						scrollPaneToTop(id);
					}}
				/>
				<div className="ml-auto flex self-stretch items-center gap-xs flex-shrink-0">
					<PaneSearchBox
						compact
						onCommit={(query) => {
							setPaneQuery(id, query);
						}}
						query={pane.query}
					/>
					{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- upstream wraps the Today IconButton in a bare clickable div; the IconButton handles keys */}
					<div onClick={() => void navigateToToday()}>
						<IconButton tooltip="Today">
							<FaIcon icon="fal:calendar-day" />
						</IconButton>
					</div>
					<HeaderMoreMenu
						anchorSelector={`[data-pane-id="${id}"] .gearMenu`}
						compact
						onRedo={onRedo}
						onUndo={onUndo}
						zoomedId={pane.zoomedId}
					/>
					<IconButton
						className="text-tertiary hover:text-on-surface flex-shrink-0"
						onClick={() => {
							closePane(id);
						}}
						tooltip="Close pane"
					>
						<FaIcon icon="fal:xmark" />
					</IconButton>
				</div>
			</div>
			{isLast && <PaneWorkspaceControl paneId={id} zoomedId={pane.zoomedId} />}
			<div className="side-pane-scroller vertical-scrollable-container">
				<PaneContext.Provider value={context}>
					<OutlineTree parentId={pane.zoomedId} />
				</PaneContext.Provider>
			</div>
		</div>
	);
}

/**
 * Upstream's pane workspace after the main pane: every open item-tree pane left to right, pinned beside the main
 * outline at an equal share of the width (`--side-pane-width`, set on `.outline-container`).
 */
export function SidePanes(actions: PaneActions) {
	const panes = useOutlineStore((state) => state.panes);
	if (panes.length === 0) {
		return null;
	}
	return (
		<div className="side-panes">
			{panes.map((pane, index) => (
				<SidePane isLast={index === panes.length - 1} key={pane.id} pane={pane} {...actions} />
			))}
		</div>
	);
}
