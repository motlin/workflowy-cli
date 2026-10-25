import {memo, useEffect, useRef, useState} from "react";
import type {CSSProperties, MouseEvent as ReactMouseEvent, ReactNode} from "react";
import {useStableNavigate} from "../hooks/use-stable-navigate.js";
import type {NodeResponse} from "../../node-types.js";
import {friendlyPrefix} from "@workflowy/shared";
import {useDayPrefix} from "../hooks/use-calendar-settings.js";
import {useChildren} from "../hooks/use-nodes.js";
import {useDateSettings} from "../hooks/use-preferences.js";
import {renderDatePills} from "../date-pills.js";
import type {DateSettings} from "../date-settings.js";
import {addMonolithGuards} from "../monolith-guards.js";
import {nodeUrl} from "../navigation.js";
import {leftBarExpansionKey, pageUniqueId, useLeftBarExpansionStore} from "../stores/left-bar-expansions.js";
import type {LeftBarSectionName} from "../stores/left-bar-expansions.js";
import {useOutlineStore} from "../stores/outline.js";
import {rowHasChildren} from "../tree-ops.js";
import {triangleSvg} from "./fa-icons.js";

type ArrowStyle = CSSProperties & Record<"--opacity" | "--hover-opacity", number>;

/**
 * Upstream's FilesList arrow opacities (`kx4` k1/y1): a row with no potentially visible
 * children is dimmer, and the current row is brighter than its siblings.
 */
function filesListArrowStyle(noChildren: boolean, current: boolean): ArrowStyle {
	if (noChildren) {
		return {"--opacity": current ? 0.2 : 0.15, "--hover-opacity": current ? 0.65 : 0.45};
	}
	return {"--opacity": current ? 0.65 : 0.45, "--hover-opacity": 1};
}

function isListed(node: NodeResponse, showCompleted: boolean): boolean {
	if (node.completedAt !== null && !showCompleted) {
		return false;
	}
	return Boolean(node.name) || Boolean(node.note) || node.hasChildren !== false;
}

/**
 * A name fragment: stored HTML keeps its colors and formatting; plain text (a custom star name) is escaped. A plain
 * element, not a component, so a row mounts no fiber for it.
 */
export function rowName({
	html,
	text,
	dates,
	prefix,
}: {
	html?: string;
	text?: string;
	/** Render stored `<time>` markup as date pills with these settings, as outline rows do. */
	dates?: DateSettings;
	/** The friendly day prefix (`Today, `), a sibling before the label as upstream's `item:icon` decorator renders it. */
	prefix?: string | null;
}) {
	const shown = html !== undefined && dates !== undefined ? addMonolithGuards(renderDatePills(html, dates)) : html;
	return (
		<>
			{prefix}
			<span style={{pointerEvents: "none", whiteSpace: "nowrap"}}>
				{shown === undefined ? (
					<span className="innerContentContainer">{text}</span>
				) : (
					<span
						className="innerContentContainer"
						// oxlint-disable-next-line react/no-danger -- node names are stored HTML; colors and formatting must survive
						dangerouslySetInnerHTML={{__html: shown}}
					/>
				)}
			</span>
		</>
	);
}

/** The local-midnight date a `YYYYMMDD` dateId names. */
function dateOfId(dateId: number): Date {
	return new Date(Math.floor(dateId / 10_000), (Math.floor(dateId / 100) % 100) - 1, dateId % 100);
}

/** A node's left-bar label: its rich name with date pills, plus `Today, ` on a calendar day node. */
export function useNodeRowName(node: Pick<NodeResponse, "name" | "calendar"> | undefined) {
	const dates = useDateSettings();
	const dayPrefix = useDayPrefix(undefined);
	const [now] = useState(() => new Date());
	const dateId = node?.calendar?.level === "day" ? node.calendar.dateId : null;
	const prefix = dateId !== null && dayPrefix ? friendlyPrefix(dateOfId(dateId), now) : null;
	return rowName({html: nodeNameHtml(node?.name), dates, prefix: prefix === null ? null : `${prefix}, `});
}

/** A node's rich name, or "Untitled" when it has none. */
function nodeNameHtml(name: string | null | undefined): string {
	return name === null || name === undefined || name === "" ? "Untitled" : name;
}

/** The expand triangle; clicks toggle without following the row's link. A plain element, not a component. */
export function filesListArrow({
	expanded,
	noChildren,
	current,
	onToggle,
}: {
	expanded: boolean;
	noChildren: boolean;
	current: boolean;
	onToggle: () => void;
}) {
	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- verbatim upstream markup: a plain clickable div arrow
		<div
			className={`flex shrink-0 items-center justify-center opacity-[var(--opacity)] hover:opacity-[var(--hover-opacity)] arrow ${expanded ? "expanded" : ""}`}
			data-left-bar-controls
			onClick={(event) => {
				event.stopPropagation();
				event.preventDefault();
				onToggle();
			}}
			style={filesListArrowStyle(noChildren, current)}
		>
			<div>{triangleSvg("block transition-transform duration-200 ease-base [.expanded_&]:rotate-90")}</div>
		</div>
	);
}

interface LeftBarRowProps {
	href: string;
	depth: number;
	current: boolean;
	completed: boolean;
	expanded: boolean;
	arrow: ReactNode;
	label: ReactNode;
	controls?: ReactNode;
}

/** A row's hover state and link navigation, which `leftBarRowLink` renders with. */
function useLeftBarRowState() {
	const navigate = useStableNavigate();
	const [hovered, setHovered] = useState(false);
	return {navigate, hovered, setHovered};
}

/** One upstream FilesList row: a link with an arrow slot, a label, and hover-only controls. */
function leftBarRowLink(
	{href, depth, current, completed, expanded, arrow, label, controls}: LeftBarRowProps,
	{navigate, hovered, setHovered}: ReturnType<typeof useLeftBarRowState>,
) {
	const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return;
		}
		event.preventDefault();
		void navigate(href);
	};

	return (
		<a
			className={`flex justify-between items-center pr-m hover:cursor-pointer ${completed ? "hover:line-through" : "hover:no-underline"} left-bar-section-item font-custom `}
			draggable="false"
			href={href}
			onClick={handleClick}
			onMouseEnter={() => {
				setHovered(true);
			}}
			onMouseLeave={() => {
				setHovered(false);
			}}
			style={{
				paddingLeft: 12 * (depth + 1),
				background: hovered ? "var(--wf-background-tertiary)" : undefined,
				color: current ? "var(--wf-text-secondary)" : "var(--wf-text-tertiary)",
				textDecoration: completed ? "line-through" : undefined,
				opacity: completed ? 0.5 : undefined,
			}}
		>
			<div
				className="flex grow items-center min-w-0 h-[30px] pl-xs text-tertiary"
				style={{fontWeight: current ? 600 : 400}}
			>
				{arrow}
				<div className="grow py-xs truncate" data-expanded={expanded}>
					{label}
				</div>
			</div>
			{hovered ? (
				<div className="flex flex-row items-center pl-xs gap-m item-controls" data-left-bar-controls>
					{controls}
				</div>
			) : null}
		</a>
	);
}

/** A left-bar row with hover controls, for the Starred section's rows. */
export function LeftBarRow(props: LeftBarRowProps) {
	return leftBarRowLink(props, useLeftBarRowState());
}

const ROW_HEIGHT = 32;
const LIMIT_PADDING = 100;
const LIMIT_HYSTERESIS = 40;

/** Upstream's FilesList render limit: rows to the bottom of the scroller's viewport, plus 100. */
export function renderLimit({
	scrollTop,
	offsetHeight,
	rulerOffsetTop,
}: {
	scrollTop: number;
	offsetHeight: number;
	rulerOffsetTop: number;
}): number {
	return Math.ceil(Math.max(0, scrollTop + offsetHeight - rulerOffsetTop) / ROW_HEIGHT) + LIMIT_PADDING;
}

/** The limit is only replaced when it moves by more than 40, as upstream. */
export function nextLimit(current: number, computed: number): number {
	return Math.abs(computed - current) > LIMIT_HYSTERESIS ? computed : current;
}

/** Tracks the render limit of the list whose ruler element `ruler` is, from its `.scroller` ancestor. */
function useRenderLimit(ruler: {current: HTMLElement | null}): number {
	const [limit, setLimit] = useState(() => renderLimit({scrollTop: 0, offsetHeight: 0, rulerOffsetTop: 0}));
	useEffect(() => {
		const element = ruler.current;
		const scroller = element?.closest<HTMLElement>(".scroller");
		const update = () => {
			if (!element || !scroller) {
				return;
			}
			const computed = renderLimit({
				scrollTop: scroller.scrollTop,
				offsetHeight: scroller.offsetHeight,
				rulerOffsetTop: element.offsetTop,
			});
			setLimit((current) => nextLimit(current, computed));
		};
		update();
		scroller?.addEventListener("scroll", update);
		window.addEventListener("resize", update);
		return () => {
			scroller?.removeEventListener("scroll", update);
			window.removeEventListener("resize", update);
		};
	}, [ruler]);
	return limit;
}

/**
 * Upstream's left-bar FilesList: a flat run of rows for `parentId`'s children, each followed by its
 * own children's rows when expanded. Expansion is account state keyed `leftbar__<section>__<top row>__<id8>`.
 * The `windowed` root renders a ruler and limits its rows (and those under them) to the scroll window;
 * `budget` is the rows a nested list may still render.
 */
export function FilesListRows({
	parentId,
	depth,
	section,
	topUniqueId,
	windowed = false,
	budget,
	limit: forcedLimit,
}: {
	parentId: string | null;
	depth: number;
	section: LeftBarSectionName;
	/** The enclosing top-level row's unique id; top-level rows use their own. */
	topUniqueId?: string;
	windowed?: boolean;
	budget?: number;
	/** Overrides the measured limit (tests). */
	limit?: number;
}) {
	const {data: nodes} = useChildren(parentId);
	const showCompleted = useOutlineStore((state) => state.showCompleted);
	const keys = useLeftBarExpansionStore((state) => state.keys);
	const ruler = useRef<HTMLDivElement>(null);
	const measured = useRenderLimit(ruler);
	const available = windowed ? (forcedLimit ?? measured) : (budget ?? Number.POSITIVE_INFINITY);

	const listed = nodes?.filter((node) => isListed(node, showCompleted)).slice(0, Math.max(0, available));
	return (
		<>
			{windowed ? <div ref={ruler} /> : null}
			{listed?.map((node, index) => {
				const top = topUniqueId ?? pageUniqueId(node.id);
				return (
					<FilesListBranch
						budget={available - index - 1}
						depth={depth}
						expanded={keys.has(leftBarExpansionKey(section, top, node.id))}
						key={node.id}
						node={node}
						section={section}
						topUniqueId={top}
					/>
				);
			})}
		</>
	);
}

/**
 * One FilesList row and, when expanded, its children's rows: one component per row. Memoized so a save that patches
 * one row of a children list re-renders only that row's branch, and a zoom only the rows it makes or stops current.
 */
const FilesListBranch = memo(function FilesListBranch({
	node,
	depth,
	section,
	topUniqueId,
	expanded,
	budget,
}: {
	node: NodeResponse;
	depth: number;
	section: LeftBarSectionName;
	topUniqueId: string;
	expanded: boolean;
	budget: number;
}) {
	const toggle = useLeftBarExpansionStore((state) => state.toggle);
	const current = useOutlineStore((state) => state.zoomedNodeId === node.id);
	const showCompleted = useOutlineStore((state) => state.showCompleted);
	const rowState = useLeftBarRowState();
	const nameLabel = useNodeRowName(node);
	return (
		<>
			{leftBarRowLink(
				{
					arrow: filesListArrow({
						current,
						expanded,
						noChildren: !rowHasChildren(node, showCompleted),
						onToggle: () => {
							// Upstream skips items with no children at all (completed ones count).
							if (node.hasChildren !== false) {
								toggle(leftBarExpansionKey(section, topUniqueId, node.id));
							}
						},
					}),
					completed: node.completedAt !== null,
					current,
					depth,
					expanded,
					href: nodeUrl(node.id),
					label: nameLabel,
				},
				rowState,
			)}
			{expanded ? (
				<FilesListRows
					budget={budget}
					depth={depth + 1}
					parentId={node.id}
					section={section}
					topUniqueId={topUniqueId}
				/>
			) : null}
		</>
	);
});
