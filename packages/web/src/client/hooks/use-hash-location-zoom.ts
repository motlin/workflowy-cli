import {skipToken, useQuery, useQueryClient} from "@tanstack/react-query";
import {useLayoutEffect} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import type {NodeResponse} from "../../node-types.js";
import {locationUrl, parseLocationHash} from "../location.js";
import {resolveZoomTarget, zoomToCachedLocation} from "../navigation.js";
import {cachedResolvedId, nodeKeys} from "../node-cache.js";
import {PANES_FRAGMENT} from "../pane-url.js";
import {readJson} from "../read-json.js";
import {useOutlineStore} from "../stores/outline.js";

/** Resolve a location id (short or full) to the node's full uuid; null when the server has no such node. */
export async function fetchResolvedId(locationId: string): Promise<string | null> {
	const response = await fetch(`/api/v1/nodes/${encodeURIComponent(locationId)}`);
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new Error(`Failed to resolve node: ${response.statusText}`);
	}
	const data = await readJson<{node: NodeResponse}>(response);
	return data.node.id;
}

/**
 * Zooms the outline to the node named by the `#/<id>?q=` hash and, like upstream, pushes the canonical URL when it
 * differs (`#/<full uuid>` becomes `#/<12hex>`; an unknown id becomes `/` and drops `?q=`). A `panes=v2.` param
 * survives canonicalization.
 *
 * An id any cached node carries resolves without a request, and the zoom lands before paint: browser Back/Forward
 * and plain link clicks zoom from the `popstate` event itself, in the same render as the router's location update,
 * and every other URL change zooms in a layout effect. Only an id the cache has never seen waits for the lookup.
 */
export function useHashLocationZoom(): void {
	const location = useLocation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const zoom = useOutlineStore((state) => state.zoom);
	const setUrlSearchQuery = useOutlineStore((state) => state.setUrlSearchQuery);
	const {id, query, fragments} = parseLocationHash(location.hash);
	const panes = fragments[PANES_FRAGMENT];
	const resolved = useQuery({
		queryKey: nodeKeys.resolvedId(id ?? ""),
		queryFn: id === null ? skipToken : async () => fetchResolvedId(id),
		initialData: () => (id === null ? undefined : cachedResolvedId(queryClient, id)),
		staleTime: Number.POSITIVE_INFINITY,
	});
	const unknown = resolved.data === null;
	const target = resolveZoomTarget(id, () => resolved.data ?? null);
	const currentUrl = location.pathname + location.hash;

	useLayoutEffect(() => {
		const zoomFromHistory = () => {
			zoomToCachedLocation(globalThis.location.hash, (locationId) => cachedResolvedId(queryClient, locationId));
		};
		globalThis.addEventListener("popstate", zoomFromHistory);
		return () => {
			globalThis.removeEventListener("popstate", zoomFromHistory);
		};
	}, [queryClient]);

	useLayoutEffect(() => {
		if (unknown) {
			zoom(null);
			void navigate("/");
			return;
		}
		if (target === null) {
			return;
		}
		const fullId = target === "home" ? null : target;
		zoom(fullId);
		const canonical = locationUrl({
			id: fullId,
			query,
			fragments: panes === undefined ? {} : {[PANES_FRAGMENT]: panes},
		});
		if (canonical !== currentUrl) {
			void navigate(canonical);
		}
	}, [currentUrl, navigate, panes, query, target, unknown, zoom]);

	useLayoutEffect(() => {
		setUrlSearchQuery(query);
	}, [query, setUrlSearchQuery]);
}
