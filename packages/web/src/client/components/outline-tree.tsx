import {useVirtualizer} from '@tanstack/react-virtual';
import {useRef} from 'react';
import {useFlattenedTree} from '../hooks/use-flattened-tree.js';
import {useChildren, useCreateNode, useNode} from '../hooks/use-nodes.js';
import {useOutlineStore} from '../stores/outline.js';
import {OutlineNode, VirtualizedOutlineNode} from './outline-node.js';

interface OutlineTreeProps {
	parentId: string | null;
}

interface AddButtonProps {
	parentId: string | null;
	depth?: number;
}

const INDENT_PER_LEVEL = 36;

/**
 * Button to add a new sibling node at the end of a list.
 * Appears below the last item in each children list.
 * Uses Workflowy's iconButton styling pattern.
 */
function AddButton({parentId, depth = 0}: AddButtonProps) {
	const createNode = useCreateNode();

	const handleClick = () => {
		createNode.mutate({
			parent_id: parentId ?? undefined,
			name: '',
		});
	};

	const indentStyle = {
		paddingLeft: `${depth * INDENT_PER_LEVEL}px`,
	};

	return (
		<div
			className="add-button-container"
			style={indentStyle}
		>
			<button
				aria-label="Add new item"
				className="addChildButton iconButton ms shape-circle"
				onClick={handleClick}
				type="button"
			>
				<svg
					aria-hidden="true"
					className="fa-plus"
					fill="currentColor"
					focusable="false"
					role="img"
					viewBox="0 0 448 512"
				>
					<path d="M240 80c0-8.8-7.2-16-16-16s-16 7.2-16 16V224H64c-8.8 0-16 7.2-16 16s7.2 16 16 16H208V400c0 8.8 7.2 16 16 16s16-7.2 16-16V256H384c8.8 0 16-7.2 16-16s-7.2-16-16-16H240V80z" />
				</svg>
			</button>
		</div>
	);
}

const ESTIMATED_ROW_HEIGHT = 24;
const OVERSCAN_COUNT = 10;

/**
 * Displays the zoomed node's name as a title when zoomed into a node.
 * Preserves HTML formatting including colored text spans.
 */
function ZoomedNodeTitle({nodeId}: {nodeId: string}) {
	const {data: node} = useNode(nodeId);

	if (!node) {
		return null;
	}

	return (
		<div
			className="zoomed-node-title"
			dangerouslySetInnerHTML={{__html: node.name || ''}}
		/>
	);
}

/**
 * Renders a virtualized tree of outline nodes.
 * Uses @tanstack/react-virtual for efficient rendering of large trees.
 * Only renders visible nodes plus an overscan buffer.
 */
export function OutlineTree({parentId}: OutlineTreeProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLElement | null>(null);
	const {flattenedNodes, isLoading, error} = useFlattenedTree(parentId);

	// Find the .outline-container scroll parent for the virtualizer
	// This ensures the scrollbar appears at the viewport's right edge
	const getScrollElement = () => {
		if (scrollRef.current) return scrollRef.current;
		const el = containerRef.current?.closest('.outline-container') as HTMLElement | null;
		if (el) scrollRef.current = el;
		return el;
	};

	const virtualizer = useVirtualizer({
		count: flattenedNodes.length,
		getScrollElement,
		estimateSize: () => ESTIMATED_ROW_HEIGHT,
		overscan: OVERSCAN_COUNT,
		getItemKey: (index) => flattenedNodes[index].node.id,
		scrollMargin: containerRef.current?.offsetTop ?? 0,
	});

	if (isLoading) {
		return <div className="outline-tree-loading">Loading...</div>;
	}

	if (error) {
		return <div className="outline-tree-error">Error loading nodes: {error.message}</div>;
	}

	if (flattenedNodes.length === 0) {
		return (
			<div
				className="outline-tree-container"
				ref={containerRef}
			>
				<div className="scroller">
					{parentId && <ZoomedNodeTitle nodeId={parentId} />}
					<AddButton
						depth={0}
						parentId={parentId}
					/>
				</div>
			</div>
		);
	}

	const virtualItems = virtualizer.getVirtualItems();

	return (
		<div
			className="outline-tree-container"
			ref={containerRef}
		>
			<div className="scroller">
				{parentId && <ZoomedNodeTitle nodeId={parentId} />}
				<div
					className="outline-tree-virtualizer"
					style={{
						height: `${virtualizer.getTotalSize()}px`,
						width: '100%',
						position: 'relative',
					}}
				>
					{virtualItems.map((virtualItem) => {
						const flattenedNode = flattenedNodes[virtualItem.index];
						return (
							<div
								data-index={virtualItem.index}
								key={flattenedNode.node.id}
								ref={virtualizer.measureElement}
								style={{
									position: 'absolute',
									top: 0,
									left: 0,
									width: '100%',
									transform: `translateY(${virtualItem.start - virtualizer.options.scrollMargin}px)`,
								}}
							>
								<VirtualizedOutlineNode
									depth={flattenedNode.depth}
									hasChildren={flattenedNode.hasChildren}
									isExpanded={flattenedNode.isExpanded}
									node={flattenedNode.node}
								/>
							</div>
						);
					})}
				</div>
				<AddButton
					depth={0}
					parentId={parentId}
				/>
			</div>
		</div>
	);
}

/**
 * Legacy recursive OutlineTree for nested rendering within expanded nodes.
 * Used by OutlineNode when a node is expanded to fetch and display children.
 */
export function RecursiveOutlineTree({parentId, depth = 0}: {parentId: string | null; depth?: number}) {
	const {data: nodes, isLoading, error} = useChildren(parentId);
	const {expandedIds, showCompleted} = useOutlineStore();

	if (isLoading) {
		return <div className="outline-tree-loading">Loading...</div>;
	}

	if (error) {
		return <div className="outline-tree-error">Error loading nodes: {error.message}</div>;
	}

	if (!nodes || nodes.length === 0) {
		return (
			<AddButton
				depth={depth}
				parentId={parentId}
			/>
		);
	}

	const visibleNodes = showCompleted ? nodes : nodes.filter((node) => node.completedAt === null);

	const treeClassName = depth > 0 ? 'outline-tree outline-tree-nested' : 'outline-tree';

	return (
		<>
			<ul className={treeClassName}>
				{visibleNodes.map((node) => {
					const isExpanded = expandedIds.has(node.id);
					return (
						<OutlineNode
							depth={depth}
							isExpanded={isExpanded}
							key={node.id}
							node={node}
						/>
					);
				})}
			</ul>
			<AddButton
				depth={depth}
				parentId={parentId}
			/>
		</>
	);
}
