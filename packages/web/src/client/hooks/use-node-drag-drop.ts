import {useState} from 'react';
import {z} from 'zod';
import {useMoveNode, useReorderNode} from './use-nodes.js';

const DragDataSchema = z.object({
	nodeId: z.string(),
	parentId: z.string().nullable(),
	priority: z.number(),
});

type DropPosition = 'above' | 'below' | 'child';

interface NodeDragDropOptions {
	nodeId: string;
	parentId: string | null;
	priority: number;
}

/**
 * Encapsulates drag-and-drop state and handlers for outline nodes.
 * Used by both VirtualizedOutlineNode and OutlineNode to avoid duplication.
 */
export function useNodeDragDrop({nodeId, parentId, priority}: NodeDragDropOptions) {
	const moveNode = useMoveNode();
	const reorderNode = useReorderNode();

	const [isDragging, setIsDragging] = useState(false);
	const [isDragOver, setIsDragOver] = useState(false);
	const [dragOverPosition, setDragOverPosition] = useState<DropPosition | null>(null);

	const handleDragStart = (event: React.DragEvent) => {
		event.stopPropagation();
		setIsDragging(true);

		event.dataTransfer.setData(
			'application/json',
			JSON.stringify({
				nodeId,
				parentId,
				priority,
			}),
		);
		event.dataTransfer.effectAllowed = 'move';
	};

	const handleDragEnd = () => {
		setIsDragging(false);
	};

	const handleDragOver = (event: React.DragEvent) => {
		event.preventDefault();
		event.stopPropagation();

		const rect = event.currentTarget.getBoundingClientRect();
		const relativeY = event.clientY - rect.top;
		const {height} = rect;

		let position: DropPosition;
		if (relativeY < height * 0.25) {
			position = 'above';
		} else if (relativeY > height * 0.75) {
			position = 'below';
		} else {
			position = 'child';
		}

		setIsDragOver(true);
		setDragOverPosition(position);

		event.dataTransfer.dropEffect = 'move';
	};

	const handleDragLeave = (event: React.DragEvent) => {
		const relatedTarget = event.relatedTarget as Node | null;
		if (!event.currentTarget.contains(relatedTarget)) {
			setIsDragOver(false);
			setDragOverPosition(null);
		}
	};

	const handleDrop = (event: React.DragEvent) => {
		event.preventDefault();
		event.stopPropagation();

		const currentDropPosition = dragOverPosition;
		setIsDragOver(false);
		setDragOverPosition(null);

		const dataString = event.dataTransfer.getData('application/json');
		if (!dataString) return;

		const parseResult = DragDataSchema.safeParse(JSON.parse(dataString));
		if (!parseResult.success) return;
		const {data} = parseResult;

		if (data.nodeId === nodeId) return;

		if (currentDropPosition === 'child') {
			moveNode.mutate({
				nodeId: data.nodeId,
				parent_id: nodeId,
				position: 0,
			});
		} else if (currentDropPosition === 'above' || currentDropPosition === 'below') {
			const newPosition = currentDropPosition === 'above' ? -1 : 1;

			if (data.parentId === parentId) {
				reorderNode.mutate({
					nodeId: data.nodeId,
					parentId,
					position: newPosition,
				});
			} else {
				moveNode.mutate({
					nodeId: data.nodeId,
					parent_id: parentId,
					position: newPosition,
				});
			}
		}
	};

	return {
		isDragging,
		isDragOver,
		dragOverPosition,
		handleDragStart,
		handleDragEnd,
		handleDragOver,
		handleDragLeave,
		handleDrop,
	};
}
