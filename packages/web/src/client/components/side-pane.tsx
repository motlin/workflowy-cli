import type {ReactNode} from "react";
import {useEffect, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {useQueryClient} from "@tanstack/react-query";
import type {QueryClient} from "@tanstack/react-query";
import {useNavigate} from "react-router-dom";
import {stripHtmlTags} from "@workflowy/shared/html";
import {useNavigateToToday} from "../hooks/use-navigate-to-today.js";
import {movePane} from "../navigation.js";
import {readNode} from "../node-cache.js";
import {MAIN_PANE_ID, findPane} from "../pane-ids.js";
import type {ItemTreePane} from "../pane-ids.js";
import {bindPaneReorder} from "../pane-reorder.js";
import type {ReorderView} from "../pane-reorder.js";
import {paneResizeHandlers} from "../pane-resize.js";
import {useOutlineStore, workspacePaneIds} from "../stores/outline.js";
import {Breadcrumbs} from "./breadcrumbs.js";
import {FaIcon} from "./fa-icons.js";
import {POPUP_Z} from "./flyout/popover-box.js";
import {HeaderMoreMenu} from "./header-more-menu.js";
import {IconButton} from "./icon-button.js";
import {OutlineTree} from "./outline-tree.js";
import {PANE_HEADER_ACTIVE_BORDER, PaneContext, paneActivation, scrollPaneToTop} from "./pane-context.js";
import {PaneSearchBox} from "./pane-search-box.js";
import {NewPaneIcon} from "./new-pane-icon.js";

/** Upstream's flex sizing for a pane: its width is its share of the workspace, above the 350px pane minimum. */
function paneFlex(width: number | undefined): string | undefined {
	return width === undefined ? undefined : `${width} 1 0px`;
}

/** Upstream's item-tree pane title (`getNameText`): the plain text of the pane's zoom, Home at the root. */
function paneTitle(queryClient: QueryClient, paneId: string): string {
	const state = useOutlineStore.getState();
	const pane = findPane(state.panes, paneId);
	const zoomedId = pane === undefined ? state.zoomedNodeId : pane.zoomedId;
	return zoomedId === null ? "Home" : stripHtmlTags(readNode(queryClient, zoomedId)?.name ?? "");
}

/** Upstream's header-drag overlay, portaled to the body: the tint drop line and the ghost chip under the pointer. */
function ReorderOverlay({view}: {view: ReorderView}) {
	return createPortal(
		<>
			{view.dropLine !== null && (
				<div
					aria-hidden
					className="fixed w-xs bg-tint rounded-pill pointer-events-none print:hidden"
					style={{
						left: view.dropLine.left,
						top: view.dropLine.top,
						height: view.dropLine.height,
						transform: "translateX(-50%)",
						zIndex: POPUP_Z,
					}}
				/>
			)}
			<div
				aria-hidden
				className="fixed translate-x-ml translate-y-ml flex items-center gap-s max-w-[280px] px-m py-s text-s text-primary bg-secondary border border-solid border-primary rounded-s shadow-md pointer-events-none print:hidden"
				style={{left: view.pointerX, top: view.pointerY, zIndex: POPUP_Z}}
			>
				<FaIcon className="flex-shrink-0 text-tertiary" icon="fal:grip-dots-vertical" />
				<span className="truncate">{view.title}</span>
			</div>
		</>,
		document.body,
	);
}

/**
 * Upstream's pane workspace (`[data-pane-workspace]`): while a pane is open, a full-height flex row of the main pane
 * and every open pane, each with its own scroller, that scrolls sideways once the panes' minimums outgrow the window.
 * Window resizes scale every pane to keep its share. Dragging a pane header reorders the panes (drop line and ghost
 * chip while dragging). In the single-document layout it lays nothing out, so the fixed header and document-scrolled
 * outline lay out as before.
 */
export function PaneWorkspace({children}: {children: ReactNode}) {
	const panesOpen = useOutlineStore((state) => state.panes.length > 0);
	const resizeToAvailableWidth = useOutlineStore((state) => state.resizeToAvailableWidth);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const workspaceRef = useRef<HTMLDivElement>(null);
	const [reorder, setReorder] = useState<ReorderView | null>(null);
	// The rescale does nothing with no pane open.
	useEffect(() => {
		globalThis.addEventListener("resize", resizeToAvailableWidth);
		return () => {
			globalThis.removeEventListener("resize", resizeToAvailableWidth);
		};
	}, [resizeToAvailableWidth]);
	useEffect(() => {
		const workspace = workspaceRef.current;
		const unbind =
			panesOpen && workspace !== null
				? bindPaneReorder(workspace, {
						getState: useOutlineStore.getState,
						title: (paneId) => paneTitle(queryClient, paneId),
						movePane: (paneId, index) => {
							movePane(navigate, paneId, index);
						},
						onView: setReorder,
					})
				: null;
		return () => {
			unbind?.();
		};
	}, [navigate, panesOpen, queryClient]);
	return panesOpen ? (
		<div
			data-pane-workspace="true"
			data-pane-reordering={reorder === null ? "false" : "true"}
			className={`pane-workspace flex h-screen max-h-screen min-h-0 items-stretch overflow-x-auto overflow-y-hidden bg-primary [&_.wf-pane-header]:cursor-grab${reorder === null ? "" : " cursor-grabbing [&_*]:!cursor-grabbing [&_*]:!pointer-events-none"}`}
			ref={workspaceRef}
		>
			{children}
			{reorder !== null && <ReorderOverlay view={reorder} />}
		</div>
	) : (
		<div className="pane-workspace contents">{children}</div>
	);
}

/**
 * The main outline's pane. In the single-document layout it is a `display: contents` wrapper around its header and
 * outline, so the fixed header and document-scrolled outline lay out as before. While a pane is open it is the
 * workspace's first flex item, its header in flow above its own scroller. It is the active pane (header border tinted)
 * only while a pane is open and the main outline last saw a pointerdown or focusin.
 */
export function MainPane({children}: {children: ReactNode}) {
	const panesOpen = useOutlineStore((state) => state.panes.length > 0);
	const isActive = useOutlineStore((state) => state.panes.length > 0 && state.activePaneId === MAIN_PANE_ID);
	const width = useOutlineStore((state) => (state.panes.length > 0 ? state.paneWidths[MAIN_PANE_ID] : undefined));
	const setActivePane = useOutlineStore((state) => state.setActivePane);
	return (
		<div
			data-pane-id={MAIN_PANE_ID}
			data-pane-type="item-tree"
			data-pane-active={isActive ? "true" : "false"}
			className={
				panesOpen
					? "main-pane group/pane shrink-0 min-w-[350px] relative box-border h-full max-h-full min-h-0 flex flex-col"
					: "main-pane group/pane contents"
			}
			style={panesOpen ? {flex: paneFlex(width)} : undefined}
			{...paneActivation(MAIN_PANE_ID, setActivePane)}
		>
			{children}
		</div>
	);
}

/** Every pane's rendered width in workspace order, main first, for a resize drag's start. */
function measurePaneWidths(): number[] {
	return workspacePaneIds(useOutlineStore.getState()).map(
		(id) => document.querySelector(`[data-pane-id="${id}"]`)?.getBoundingClientRect().width ?? 0,
	);
}

/**
 * Upstream's resize handle on a secondary pane's left edge: dragging it trades width between the pane (at workspace
 * `index`) and its left neighbour, each stopping at the 350px minimum.
 */
function PaneResizeHandle({index}: {index: number}) {
	const setPaneWidths = useOutlineStore((state) => state.setPaneWidths);
	const [handlers] = useState(() =>
		paneResizeHandlers(index, {measure: measurePaneWidths, setWidths: setPaneWidths}),
	);
	return (
		<div
			className="pane-resize-handle absolute top-0 bottom-0 left-0 w-[4px] cursor-ew-resize"
			onPointerDown={handlers.onPointerDown}
			onPointerMove={handlers.onPointerMove}
			onPointerUp={handlers.onPointerUp}
		/>
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
	/** The pane's workspace index, counting the main pane as 0. */
	index: number;
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
function SidePane({pane, index, isLast, onUndo, onRedo}: SidePaneProps) {
	const {id} = pane;
	const width = useOutlineStore((state) => state.paneWidths[id]);
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
			className="side-pane group/pane relative box-border flex-none h-full max-h-full min-h-0 min-w-[350px] bg-primary flex flex-col"
			style={{flex: paneFlex(width)}}
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
						paneId={id}
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
			<PaneResizeHandle index={index} key={index} />
		</div>
	);
}

/** Upstream's secondary panes: every open item-tree pane left to right, after the main pane in the workspace. */
export function SidePanes(actions: PaneActions) {
	const panes = useOutlineStore((state) => state.panes);
	return panes.map((pane, index) => (
		<SidePane index={index + 1} isLast={index === panes.length - 1} key={pane.id} pane={pane} {...actions} />
	));
}
