import {useState} from "react";
import type {CSSProperties, MouseEvent as ReactMouseEvent, ReactNode} from "react";
import {useNavigate} from "react-router-dom";
import type {NodeResponse} from "../../node-types.js";
import {useChildren} from "../hooks/use-nodes.js";
import {nodeUrl} from "../navigation.js";
import {useLeftBarExpansionStore} from "../stores/left-bar-expansions.js";
import {useOutlineStore} from "../stores/outline.js";
import {TriangleSvg} from "./fa-icons.js";

const ARROW_STYLE: CSSProperties & Record<"--opacity" | "--hover-opacity", number> = {
	"--opacity": 0.45,
	"--hover-opacity": 1,
};

function isListed(node: NodeResponse, showCompleted: boolean): boolean {
	if (node.completedAt !== null && !showCompleted) {
		return false;
	}
	return Boolean(node.name) || Boolean(node.note) || node.hasChildren !== false;
}

/** One upstream FilesList row: a link with a triangle, the raw name HTML, and hover-only controls. */
function FilesListRow({
	node,
	depth,
	expanded,
	onToggle,
	controls,
}: {
	node: NodeResponse;
	depth: number;
	expanded: boolean;
	onToggle: () => void;
	controls?: ReactNode;
}) {
	const navigate = useNavigate();
	const current = useOutlineStore((state) => state.zoomedNodeId) === node.id;
	const [hovered, setHovered] = useState(false);
	const completed = node.completedAt !== null;
	const href = nodeUrl(node.id);

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
				{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- verbatim upstream markup: a plain clickable div arrow */}
				<div
					className={`flex shrink-0 items-center justify-center opacity-[var(--opacity)] hover:opacity-[var(--hover-opacity)] arrow ${expanded ? "expanded" : ""}`}
					data-left-bar-controls
					onClick={(event) => {
						event.stopPropagation();
						event.preventDefault();
						onToggle();
					}}
					style={ARROW_STYLE}
				>
					<div>
						<TriangleSvg className="block transition-transform duration-200 ease-base [.expanded_&]:rotate-90" />
					</div>
				</div>
				<div className="grow py-xs truncate" data-expanded={expanded}>
					<span
						// oxlint-disable-next-line react/no-danger -- node names are stored HTML; colors and formatting must survive
						dangerouslySetInnerHTML={{
							__html: `<span class="innerContentContainer">${node.name === null || node.name === "" ? "Untitled" : node.name}</span>`,
						}}
						style={{pointerEvents: "none", whiteSpace: "nowrap"}}
					/>
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
	const toggle = useLeftBarExpansionStore((state) => state.toggle);

	return nodes
		?.filter((node) => isListed(node, showCompleted))
		.map((node) => (
			<FilesListBranch
				contextKey={contextKey}
				depth={depth}
				expanded={expandedIds?.includes(node.id) ?? false}
				key={node.id}
				node={node}
				onToggle={() => {
					toggle(contextKey, node.id);
				}}
			/>
		));
}

function FilesListBranch({
	node,
	depth,
	contextKey,
	expanded,
	onToggle,
}: {
	node: NodeResponse;
	depth: number;
	contextKey: string;
	expanded: boolean;
	onToggle: () => void;
}) {
	return (
		<>
			<FilesListRow depth={depth} expanded={expanded} node={node} onToggle={onToggle} />
			{expanded ? <FilesListRows contextKey={contextKey} depth={depth + 1} parentId={node.id} /> : null}
		</>
	);
}
