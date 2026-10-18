// fallow-ignore-file circular-dependency
// Mutual recursion between OutlineRow and OutlineChildren is intentional.
import {useChildren, useCreateNode, useNode} from "../hooks/use-nodes.js";
import {useOutlineStore} from "../stores/outline.js";
import {OutlineRow} from "./outline-node.js";

interface OutlineTreeProps {
	parentId: string | null;
}

/** Upstream's top-level `.children`: no margin, padding, or guide border. */
const ROOT_CHILDREN_CLASS =
	"children relative [.addedToSelection_&]:border-l-transparent [.item--zooming-in-progress_&]:border-l-transparent";

/** Upstream's nested `.children`: indented 36px past the parent bullet, the guide line is its left border. */
const NESTED_CHILDREN_CLASS =
	"children relative ml-[10px] pl-[25px] border-l-[length:var(--wf-border-width-s)] border-solid border-l-secondary [.addedToSelection_&]:border-l-transparent [.item--zooming-in-progress_&]:border-l-transparent";

/**
 * Button to add a new sibling node at the end of the top-level list.
 * Uses Workflowy's iconButton styling pattern.
 */
function AddButton({parentId}: {parentId: string | null}) {
	const createNode = useCreateNode();

	const handleClick = () => {
		createNode.mutate({
			parent_id: parentId ?? undefined,
			name: "",
		});
	};

	return (
		<div className="add-button-container">
			<button
				aria-label="Add new item"
				className="addChildButton iconButton ms shape-circle"
				onClick={handleClick}
				type="button"
			>
				<svg aria-hidden="true" className="fa-plus" fill="currentColor" focusable="false" viewBox="0 0 448 512">
					<path d="M240 80c0-8.8-7.2-16-16-16s-16 7.2-16 16V224H64c-8.8 0-16 7.2-16 16s7.2 16 16 16H208V400c0 8.8 7.2 16 16 16s16-7.2 16-16V256H384c8.8 0 16-7.2 16-16s-7.2-16-16-16H240V80z" />
				</svg>
			</button>
		</div>
	);
}

/**
 * Displays the zoomed node's name as a title when zoomed into a node.
 * Preserves HTML formatting including colored text spans.
 */
function ZoomedNodeTitle({nodeId}: {nodeId: string}) {
	const {data: node} = useNode(nodeId);

	if (!node) {
		return null;
	}

	return <div className="zoomed-node-title" dangerouslySetInnerHTML={{__html: node.name ?? ""}} />;
}

/**
 * Upstream's `div.children`: the visible children of `parentId`, each a recursive
 * `OutlineRow`. Renders nothing when no child is visible, so a collapsed or empty
 * parent has no `.children` in the DOM.
 */
export function OutlineChildren({parentId, isRoot = false}: {parentId: string | null; isRoot?: boolean}) {
	const {data: nodes} = useChildren(parentId);
	const showCompleted = useOutlineStore((state) => state.showCompleted);
	const visibleNodes = showCompleted ? nodes : nodes?.filter((node) => node.completedAt === null);

	if (!visibleNodes || visibleNodes.length === 0) {
		return null;
	}

	return (
		<div className={isRoot ? ROOT_CHILDREN_CLASS : NESTED_CHILDREN_CLASS}>
			{visibleNodes.map((node) => (
				<OutlineRow key={node.id} node={node} />
			))}
		</div>
	);
}

/**
 * Renders the outline under `parentId` as nested `.project` / `.children` elements,
 * matching upstream's DOM: each expanded row holds its children inline.
 */
export function OutlineTree({parentId}: OutlineTreeProps) {
	const {isLoading, error} = useChildren(parentId);

	if (isLoading) {
		return <div className="outline-tree-loading">Loading...</div>;
	}

	if (error) {
		return <div className="outline-tree-error">Error loading nodes: {error.message}</div>;
	}

	// font-custom resolves the row metrics for the root .children; upstream gets them
	// from the enclosing zoom-root .project, which M1-47 adds.
	return (
		<div className="outline-tree-container font-custom">
			<div className="scroller">
				{parentId && <ZoomedNodeTitle nodeId={parentId} />}
				<OutlineChildren isRoot parentId={parentId} />
				<AddButton parentId={parentId} />
			</div>
		</div>
	);
}
