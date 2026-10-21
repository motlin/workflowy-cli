import {useEffect, useRef, useState} from "react";
import {stripHtmlTags as stripHtml} from "@workflowy/shared/html";
import {createPortal} from "react-dom";
import {nodeUrl, useNodeNavigation} from "../navigation.js";
import type {NodeResponse} from "../../node-types.js";
import {readJson} from "../read-json.js";
import {buildItemMenu, hasFooter, localItemMenuContext} from "../item-menu-model.js";
import type {ItemMenuKey} from "../item-menu-model.js";
import {formatMenuTimestamp} from "../menu-timestamp.js";
import {closeOnEscape} from "../menu-escape.js";
import {pickerItemTypes} from "../item-type-select.js";
import {useOutlineStore} from "../stores/outline.js";
import {hasDates} from "../date-pills.js";
import type {SortDirection} from "../sort-children.js";
import {FaIcon} from "./fa-icons.js";
import {ButtonMenu} from "./flyout/button-menu.js";
import {MenuItem, MenuSeparator} from "./flyout/menu-item.js";

interface MirrorLocationPath {
	id: string;
	name: string;
}

interface MirrorLocation {
	id: string;
	path: MirrorLocationPath[];
	isOriginal: boolean;
}

interface MirrorsResponse {
	mirrors: MirrorLocation[];
	originalId: string;
	nodeName: string;
}

function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}
	return `${text.slice(0, maxLength)}...`;
}

/**
 * Modal dialog showing all mirror locations for a node.
 * Matches production Workflowy's "Mirrors for..." dialog.
 */
function MirrorsModal({data, onClose}: {data: MirrorsResponse; onClose: () => void}) {
	const {navigateToNode} = useNodeNavigation();
	const modalRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (modalRef.current && !modalRef.current.contains(event.target instanceof Node ? event.target : null)) {
				onClose();
			}
		}
		const handleEscape = closeOnEscape(onClose);
		document.addEventListener("mousedown", handleClickOutside);
		document.addEventListener("keydown", handleEscape);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
			document.removeEventListener("keydown", handleEscape);
		};
	}, [onClose]);

	const handleNavigate = (nodeId: string, event: React.MouseEvent) => {
		event.preventDefault();
		onClose();
		navigateToNode(nodeId);
	};

	const displayName = truncate(stripHtml(data.nodeName), 30);

	return createPortal(
		<div className="mirrors-modal-overlay">
			<div className="mirrors-modal" ref={modalRef}>
				<div className="mirrors-modal-header">
					<h2 className="mirrors-modal-title">Mirrors for &ldquo;{displayName}&rdquo;</h2>
					<button className="mirrors-modal-close" onClick={onClose} type="button">
						&times;
					</button>
				</div>
				<div className="mirrors-modal-body">
					{data.mirrors.map((loc, index) => {
						const breadcrumbs = loc.path.map((p) => truncate(stripHtml(p.name), 20));
						return (
							<div className={`mirrors-modal-location ${loc.isOriginal ? "original" : ""}`} key={loc.id}>
								<div className="mirrors-modal-location-label">
									{loc.isOriginal ? "Original" : "Linked copy"}
								</div>
								<a
									className="mirrors-modal-location-path"
									href={nodeUrl(loc.id)}
									onClick={(event) => {
										handleNavigate(loc.id, event);
									}}
								>
									<span className="mirrors-modal-location-number">{index + 1}.</span>
									{breadcrumbs.map((crumb, i) => (
										// Breadcrumb names can repeat; a path segment is identified by its depth.
										// oxlint-disable-next-line react/no-array-index-key
										<span key={i}>
											{i > 0 && <span className="mirrors-modal-breadcrumb-sep"> &gt; </span>}
											<span>{crumb}</span>
										</span>
									))}
								</a>
							</div>
						);
					})}
				</div>
			</div>
		</div>,
		document.body,
	);
}

/**
 * Banner shown at the top of context menu for mirror nodes.
 * Shows mirror count with a "See them" link that opens a modal.
 */
function MirrorBanner({
	originalNodeId,
	onShowMirrors,
}: {
	originalNodeId: string;
	onShowMirrors: (data: MirrorsResponse) => void;
}) {
	const [mirrorsData, setMirrorsData] = useState<MirrorsResponse | null>(null);

	useEffect(() => {
		void (async () => {
			try {
				const response = await fetch(`/api/v1/nodes/${encodeURIComponent(originalNodeId)}/mirrors`);
				if (response.ok) {
					const data = await readJson<MirrorsResponse>(response);
					setMirrorsData(data);
				}
			} catch {
				// The mirrors badge is optional; a failed lookup just leaves it hidden.
			}
		})();
	}, [originalNodeId]);

	if (!mirrorsData || mirrorsData.mirrors.length <= 1) {
		return null;
	}

	const handleSeeAll = (event: React.MouseEvent) => {
		event.stopPropagation();
		onShowMirrors(mirrorsData);
	};

	return (
		<div className="mirror-banner">
			<span>Node has {mirrorsData.mirrors.length} mirrors. </span>
			{/* Upstream's link prevents mousedown so focus stays on the menu trigger and the menu stays open. */}
			<button
				className="mirror-banner-link"
				onClick={handleSeeAll}
				onMouseDown={(event) => {
					event.preventDefault();
				}}
				type="button"
			>
				See them
			</button>
		</div>
	);
}

export interface ItemMenuActions {
	onOpenInPane: () => void;
	onComplete: () => void;
	onAddNote: () => void;
	onAddDate: () => void;
	onDeleteDates: () => void;
	onPresent: () => void;
	onMoveTo: () => void;
	onDuplicate: () => void;
	onExport: () => void;
	onCopyLink: () => void;
	onMakeTemplate: () => void;
	onDelete: () => void;
	onExpandAll: () => void;
	onCollapseAll: () => void;
	onSort: (direction: SortDirection) => void;
}

const TURN_INTO_CLASS =
	"item-type-picker flex justify-between items-center px-l py-xs mobile:py-ml leading-base hover:bg-secondary mobile:landscape:pl-safe-left mobile:landscape:pr-safe-right cursor-pointer desktop:text-xs";

/**
 * Upstream's bullet-menu "Turn into…" row (`kV`): mousedown keeps focus on the menu; a click
 * closes the menu, then on the next tick opens the shared item-type picker at the click's page point.
 */
export function TurnIntoRow({nodeId, onClose}: {nodeId: string; onClose: () => void}) {
	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- verbatim upstream markup; the picker is also reachable by the layout hotkeys
		<div
			data-handbook="bullet.layout"
			data-handbook-placement="right"
			className={TURN_INTO_CLASS}
			onClick={(event: {pageX: number; pageY: number}) => {
				const position = {top: event.pageY, left: event.pageX};
				onClose();
				setTimeout(() => {
					useOutlineStore.getState().showItemTypePicker({nodeIds: [nodeId], position});
				});
			}}
			onMouseDown={(event: {preventDefault: () => void}) => {
				event.preventDefault();
			}}
		>
			<div className="row-start flex gap-m items-center">
				<FaIcon fixedWidth icon="fal:arrows-cross" />
				<p>Turn into…</p>
			</div>
			<div className="row-end">
				<FaIcon icon="fal:chevron-down" />
			</div>
		</div>
	);
}

function footerTimestamp(label: string, unixSeconds: number | null, now: Date) {
	return (
		<div className="flex flex-col gap-s">
			<div>
				<b>{label}</b> {unixSeconds === null ? "Unknown" : formatMenuTimestamp(unixSeconds, now)}
			</div>
		</div>
	);
}

/**
 * Upstream's item-menu body (`AV`): returned as one Fragment so MenuBody sees no navigable
 * items and ArrowDown highlights nothing. Rows come from the pure item-menu model.
 */
export function ItemMenuBody({
	node,
	actions,
	onClose,
	onShowMirrors,
}: {
	node: NodeResponse;
	actions: ItemMenuActions;
	onClose: () => void;
	onShowMirrors: (data: MirrorsResponse) => void;
}) {
	// The body mounts each time the menu opens, so "now" is the moment it opened.
	const [now] = useState(() => new Date());
	const entries = buildItemMenu(
		node,
		localItemMenuContext({hasDates: hasDates(node.name ?? "") || hasDates(node.note ?? "")}),
	);
	/** Runs the action, then closes the menu (returning false so MenuItem does not keep it open). */
	const thenClose = (run: () => void) => (): boolean => {
		run();
		onClose();
		return false;
	};
	/** Closes the menu first, for actions that move focus or open another surface. */
	const closeThen = (run: () => void) => (): boolean => {
		onClose();
		run();
		return false;
	};
	// Expand all / Collapse all return true so the menu stays open; the rest close it.
	const select: Partial<Record<ItemMenuKey, () => boolean>> = {
		open_in_pane: closeThen(actions.onOpenInPane),
		complete: thenClose(actions.onComplete),
		add_note: closeThen(actions.onAddNote),
		add_date: closeThen(actions.onAddDate),
		delete_dates: thenClose(actions.onDeleteDates),
		present_it: closeThen(actions.onPresent),
		move_to: closeThen(actions.onMoveTo),
		duplicate: thenClose(actions.onDuplicate),
		show_export: closeThen(actions.onExport),
		copy_link: thenClose(actions.onCopyLink),
		make_template: thenClose(actions.onMakeTemplate),
		delete: thenClose(actions.onDelete),
		expand_all: () => {
			actions.onExpandAll();
			return true;
		},
		collapse_all: () => {
			actions.onCollapseAll();
			return true;
		},
		sort_children_asc: thenClose(() => {
			actions.onSort("asc");
		}),
		sort_children_desc: thenClose(() => {
			actions.onSort("desc");
		}),
	};

	return (
		<>
			{node.isMirror && node.originalNodeId && (
				<MirrorBanner
					onShowMirrors={(data) => {
						onClose();
						onShowMirrors(data);
					}}
					originalNodeId={node.originalNodeId}
				/>
			)}
			{pickerItemTypes([node.id]).length > 0 && (
				<>
					<TurnIntoRow nodeId={node.id} onClose={onClose} />
					<MenuSeparator />
				</>
			)}
			{entries.map((entry, index) =>
				entry.kind === "separator" ? (
					// Separators have no identity beyond their position in the filtered list.
					// oxlint-disable-next-line react/no-array-index-key
					<MenuSeparator key={`separator${index}`} />
				) : (
					<MenuItem
						handbook={entry.key}
						icon={`fal:${entry.icon}`}
						key={entry.key}
						label={entry.label}
						onSelect={select[entry.key]}
						shortcut={entry.shortcut}
					/>
				),
			)}
			{hasFooter(node) && (
				<>
					<MenuSeparator key="separator4" />
					<div
						className={`flex flex-col gap-m text-tertiary text-xs px-l pt-s pb-ml whitespace-nowrap
            mobile:text-base  mobile:py-ml mobile:landscape:pl-safe-left mobile:landscape:pr-safe-right`}
					>
						{footerTimestamp("Changed:", node.modifiedAt, now)}
						{footerTimestamp("Created:", node.createdAt, now)}
					</div>
				</>
			)}
		</>
	);
}

interface ItemMenuTriggerProps {
	node: NodeResponse;
	/** Upstream `--item-menu-left`, from `itemMenuLeft`; omitted on the zoom title, whose CSS pins it at 65px. */
	left?: string;
	actions: ItemMenuActions;
	onOpenChange: (open: boolean) => void;
	/** Upstream fa1's controlled open state; omitted, ButtonMenu keeps its own. */
	expanded?: boolean;
	setExpanded?: (expanded: boolean) => void;
}

/** Upstream fa1's ButtonMenu placement: the flyout hangs 16px left of the trigger, up to 300px wide. */
const ITEM_MENU_OFFSET = [-16, 0] as const;

const ITEM_MENU_TRIGGER_CLASS =
	"!absolute left-[var(--item-menu-left)] top-0 h-[var(--line-height)] pt-[var(--wf-content-padding-top)] flex items-center opacity-100 cursor-pointer transition-opacity duration-200 [body.moving_&]:hidden itemMenu";

function blurActiveElement(): void {
	if (document.activeElement instanceof HTMLElement) {
		document.activeElement.blur();
	}
}

/**
 * Upstream's bullet-menu trigger: a ButtonMenu `div.menu.itemMenu` holding the three-dot
 * button. The row mounts it only while hovered or while its menu is open.
 */
export function ItemMenuTrigger({node, left, actions, onOpenChange, expanded, setExpanded}: ItemMenuTriggerProps) {
	const [mirrorsModalData, setMirrorsModalData] = useState<MirrorsResponse | null>(null);

	return (
		<>
			<ButtonMenu
				className={ITEM_MENU_TRIGGER_CLASS}
				expanded={expanded}
				maxWidth={300}
				offset={ITEM_MENU_OFFSET}
				placement="bottom-start"
				setExpanded={setExpanded}
				onHide={() => {
					onOpenChange(false);
				}}
				onShow={() => {
					onOpenChange(true);
				}}
				style={left === undefined ? undefined : {["--item-menu-left" as string]: left}}
				button={
					<span className="block size-xl rounded-[12px] text-tertiary hover:bg-tertiary">
						<svg viewBox="0 0 24 24" fill="currentColor" className="block size-full">
							<circle cx="6" cy="12" r="2" />
							<circle cx="12" cy="12" r="2" />
							<circle cx="18" cy="12" r="2" />
						</svg>
					</span>
				}
			>
				<ItemMenuBody
					actions={actions}
					node={node}
					onClose={blurActiveElement}
					onShowMirrors={(data) => {
						setMirrorsModalData(data);
					}}
				/>
			</ButtonMenu>
			{mirrorsModalData && (
				<MirrorsModal
					data={mirrorsModalData}
					onClose={() => {
						setMirrorsModalData(null);
					}}
				/>
			)}
		</>
	);
}
