import {useQueryClient} from "@tanstack/react-query";
import {useEffect} from "react";
import {contentLinkAction, internalLinkId} from "../content-link-click.js";
import {isMacPlatform} from "../editable-text-keys.js";
import {nodeKeys} from "../node-cache.js";
import {openInPane} from "../pane-commands.js";
import {MAIN_PANE_ID} from "../pane-ids.js";
import {useOutlineStore} from "../stores/outline.js";

/**
 * Upstream's document-level capture listener for internal `a.contentLink` clicks: ⌘-click (⌃ off mac) or ⌥-click opens
 * the linked item in a new pane next to the link's pane, and a plain click inside an open pane navigates that pane. Capture runs before React's
 * row handlers, so a claimed click neither follows the href nor starts editing. Mount once (the outline route owns it).
 */
export function useContentLinkClicks(resolveId: (locationId: string) => Promise<string | null>): void {
	const queryClient = useQueryClient();
	useEffect(() => {
		const handleClick = (event: MouseEvent) => {
			const link = event.target instanceof Element ? event.target.closest("a.contentLink") : null;
			const href = link?.getAttribute("href");
			if (link === null || href === null || href === undefined) {
				return;
			}
			const sourcePaneId = link.closest("[data-pane-id]")?.getAttribute("data-pane-id") ?? MAIN_PANE_ID;
			const action = contentLinkAction(event, isMacPlatform(), sourcePaneId !== MAIN_PANE_ID);
			const locationId = internalLinkId(href, globalThis.location.origin);
			if (action === null || locationId === null) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			void (async () => {
				const nodeId = await queryClient.query({
					queryKey: nodeKeys.resolvedId(locationId),
					queryFn: async () => resolveId(locationId),
					staleTime: Number.POSITIVE_INFINITY,
				});
				if (nodeId === null) {
					return;
				}
				const state = useOutlineStore.getState();
				if (action === "open_in_pane") {
					openInPane(state, nodeId, sourcePaneId);
				} else {
					state.zoomPane(sourcePaneId, nodeId);
				}
			})();
		};
		document.addEventListener("click", handleClick, true);
		return () => {
			document.removeEventListener("click", handleClick, true);
		};
	}, [queryClient, resolveId]);
}
