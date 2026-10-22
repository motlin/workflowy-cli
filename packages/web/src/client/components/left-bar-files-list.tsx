import {memo, useState} from "react";
import type {CSSProperties, MouseEvent as ReactMouseEvent, ReactNode} from "react";
import {useStableNavigate} from "../hooks/use-stable-navigate.js";
import type {NodeResponse} from "../../node-types.js";
import {useChildren} from "../hooks/use-nodes.js";
import {nodeUrl} from "../navigation.js";
import {useLeftBarExpansionStore} from "../stores/left-bar-expansions.js";
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
export function rowName({html, text}: {html?: string; text?: string}) {
	return (
		<span style={{pointerEvents: "none", whiteSpace: "nowrap"}}>
			{html === undefined ? (
				<span className="innerContentContainer">{text}</span>
			) : (
				<span
					className="innerContentContainer"
					// oxlint-disable-next-line react/no-danger -- node names are stored HTML; colors and formatting must survive
					dangerouslySetInnerHTML={{__html: html}}
				/>
			)}
		</span>
	);
}

/** A node's rich name, or "Untitled" when it has none. */
export function nodeNameHtml(name: string | null | undefined): string {
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

/**
 * Upstream's left-bar FilesList: a flat run of rows for `parentId`'s children, each followed by its
 * own children's rows when expanded in `contextKey`. Expansion is browser-local and never synced.
 */
export function FilesListRows({
	parentId,
	depth,
	contextKey,
}: {
	parentId: string | null;
	depth: number;
	contextKey: string;
}) {
	const {data: nodes} = useChildren(parentId);
	const showCompleted = useOutlineStore((state) => state.showCompleted);
	const expandedIds = useLeftBarExpansionStore((state) => state.expansions[contextKey]);

	return nodes
		?.filter((node) => isListed(node, showCompleted))
		.map((node) => (
			<FilesListBranch
				contextKey={contextKey}
				depth={depth}
				expanded={expandedIds?.includes(node.id) ?? false}
				key={node.id}
				node={node}
			/>
		));
}

/**
 * One FilesList row and, when expanded, its children's rows: one component per row. Memoized so a save that patches
 * one row of a children list re-renders only that row's branch, and a zoom only the rows it makes or stops current.
 */
const FilesListBranch = memo(function FilesListBranch({
	node,
	depth,
	contextKey,
	expanded,
}: {
	node: NodeResponse;
	depth: number;
	contextKey: string;
	expanded: boolean;
}) {
	const toggle = useLeftBarExpansionStore((state) => state.toggle);
	const current = useOutlineStore((state) => state.zoomedNodeId === node.id);
	const showCompleted = useOutlineStore((state) => state.showCompleted);
	const rowState = useLeftBarRowState();
	return (
		<>
			{leftBarRowLink(
				{
					arrow: filesListArrow({
						current,
						expanded,
						noChildren: !rowHasChildren(node, showCompleted),
						onToggle: () => {
							toggle(contextKey, node.id);
						},
					}),
					completed: node.completedAt !== null,
					current,
					depth,
					expanded,
					href: nodeUrl(node.id),
					label: rowName({html: nodeNameHtml(node.name)}),
				},
				rowState,
			)}
			{expanded ? <FilesListRows contextKey={contextKey} depth={depth + 1} parentId={node.id} /> : null}
		</>
	);
});
