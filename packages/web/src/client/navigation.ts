import {isShortId} from "@workflowy/shared/workflowy";
import {useNavigate} from "react-router-dom";
import {locationUrl} from "./location.js";

/**
 * The client URL for a node view: upstream's `/#/<last 12 chars of uuid>`.
 *
 * The hash router resolves the short id back to the full uuid before zooming, so
 * `zoomedNodeId` always holds a full id. Every node link must go through this
 * helper so the form stays consistent.
 */
export function nodeUrl(nodeId: string): string {
	return locationUrl({id: nodeId});
}

/**
 * Resolve a location id to a zoom target: `"home"` for no id, a full uuid as is,
 * and a 12-hex short id through `lookup` (null when it is unknown).
 */
export function resolveZoomTarget(param: string | null, lookup: (id: string) => string | null) {
	if (param === null) {
		return "home";
	}
	return isShortId(param) ? lookup(param) : param;
}

export function useNodeNavigation() {
	const navigate = useNavigate();

	return {
		navigateToNode: (nodeId: string | null) => {
			void navigate(nodeId === null ? "/" : nodeUrl(nodeId));
		},
		navigateToRoot: () => void navigate("/"),
	};
}
