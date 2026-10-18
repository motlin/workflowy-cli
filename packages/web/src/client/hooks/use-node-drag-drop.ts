import {useQueryClient} from "@tanstack/react-query";
import {useState} from "react";
import {z} from "zod";
import {readChildren} from "../node-cache.js";
import {dropIndex} from "../tree-ops.js";
import {useMoveNode} from "./use-nodes.js";

const DragDataSchema = z.object({
	nodeId: z.string(),
	parentId: z.string().nullable(),
	priority: z.number(),
});

type DropPosition = "above" | "below" | "child";

interface NodeDragDropOptions {
	nodeId: string;
	parentId: string | null;
	priority: number;
}

/**
 * Encapsulates drag-and-drop state and handlers for outline nodes.
 * Used by OutlineRow for its bullet and name drop target.
 */
export function useNodeDragDrop({nodeId, parentId, priority}: NodeDragDropOptions) {
	const queryClient = useQueryClient();
	const moveNode = useMoveNode();

	const [isDragging, setIsDragging] = useState(false);
	const [isDragOver, setIsDragOver] = useState(false);
	const [dragOverPosition, setDragOverPosition] = useState<DropPosition | null>(null);

	const handleDragStart = (event: React.DragEvent) => {
		event.stopPropagation();
		setIsDragging(true);

		event.dataTransfer.setData(
			"application/json",
			JSON.stringify({
				nodeId,
				parentId,
				priority,
			}),
		);
		event.dataTransfer.effectAllowed = "move";
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
			position = "above";
		} else if (relativeY > height * 0.75) {
			position = "below";
		} else {
			position = "child";
		}

		setIsDragOver(true);
		setDragOverPosition(position);

		event.dataTransfer.dropEffect = "move";
	};

	const handleDragLeave = (event: React.DragEvent) => {
		const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
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

		const dataString = event.dataTransfer.getData("application/json");
		if (!dataString) {
			return;
		}

		const parseResult = DragDataSchema.safeParse(JSON.parse(dataString));
		if (!parseResult.success) {
			return;
		}
		const {data} = parseResult;

		if (data.nodeId === nodeId) {
			return;
		}

		if (currentDropPosition === "child") {
			moveNode.mutate({nodeId: data.nodeId, parent_id: nodeId, index: 0});
		} else if (currentDropPosition === "above" || currentDropPosition === "below") {
			const siblings = readChildren(queryClient, parentId) ?? [];
			moveNode.mutate({
				nodeId: data.nodeId,
				parent_id: parentId,
				index: dropIndex(siblings, data.nodeId, nodeId, currentDropPosition),
			});
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
