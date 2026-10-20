import {useQueries, useQueryClient} from "@tanstack/react-query";
import {useEffect, useState} from "react";
import {usePreferences} from "../hooks/use-preferences.js";
import {fetchAncestors, useCreateNode} from "../hooks/use-nodes.js";
import {useStarredLocations} from "../hooks/use-starred.js";
import {
	INITIAL_PICKER_STATE,
	ancestorCrumbs,
	buildPickerRows,
	reducePicker,
	resolveDefaultLocation,
} from "../location-picker-model.js";
import type {PickerEffect, PickerEvent, PickerResult, PickerState} from "../location-picker-model.js";
import {nodeKeys, readNode} from "../node-cache.js";
import {ensureNotesLocation, notesRootIdFor} from "../notes-location.js";
import {readJson} from "../read-json.js";
import {createRecentLocations} from "../recent-locations.js";
import type {RecentLocations} from "../recent-locations.js";
import {useOutlineStore} from "../stores/outline.js";
import type {LocationPickerState} from "../stores/outline.js";
import {captureOutlineView, runInUndoBatch} from "../undo-batch.js";
import {LocationPicker} from "./location-picker.js";
import type {LocationCrumb} from "./location-picker.js";

/** One `/api/search/locations` hit: upstream's `<b><u>` word-start label and root-first ancestors without Home. */
interface SearchHit {
	id: string;
	labelHtml: string;
	ancestors: LocationCrumb[];
}

const SEARCH_DEBOUNCE_MS = 150;
const SEARCH_LIMIT = 50;
const EMPTY_HITS: readonly SearchHit[] = [];

let recents: RecentLocations | null = null;

/** Upstream's per-tab recent locations (sessionStorage `recentlySavedLocations`). */
function recentLocations(): RecentLocations {
	recents ??= createRecentLocations(sessionStorage, () => Date.now());
	return recents;
}

function escapeHtml(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** Debounced `/api/search/locations` hits for `query`; empty for an empty query. */
function useSearchHits(query: string): readonly SearchHit[] {
	const [found, setFound] = useState<{query: string; hits: readonly SearchHit[]}>({query: "", hits: []});
	useEffect(() => {
		if (query.trim() === "") {
			// oxlint-disable-next-line unicorn/no-useless-undefined -- consistent-return needs a value beside the cleanup return
			return undefined;
		}
		let live = true;
		const timer = setTimeout(() => {
			void (async () => {
				const response = await fetch("/api/search/locations", {
					method: "POST",
					headers: {"Content-Type": "application/json"},
					body: JSON.stringify({query, limit: SEARCH_LIMIT}),
				});
				if (live && response.ok) {
					setFound({query, hits: (await readJson<{results: SearchHit[]}>(response)).results});
				}
			})();
		}, SEARCH_DEBOUNCE_MS);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [query]);
	return found.query === query ? found.hits : EMPTY_HITS;
}

/** One open picker: its step machine, rows and the create-and-move sub-action. */
function LocationPickerSession({picker}: {picker: LocationPickerState}) {
	const queryClient = useQueryClient();
	const createNode = useCreateNode();
	const {preferences} = usePreferences();
	const stars = useStarredLocations();
	const closeLocationPicker = useOutlineStore((state) => state.closeLocationPicker);
	const [state, setState] = useState<PickerState>(INITIAL_PICKER_STATE);
	const hits = useSearchHits(state.query);

	const nameOf = (id: string): string =>
		readNode(queryClient, id)?.name ?? stars.find((star) => star.nodeId === id)?.name ?? "";
	const recentIds = recentLocations().ids();
	const defaultLocation = resolveDefaultLocation({
		recentId: recentIds[0] ?? null,
		notesRootId: notesRootIdFor(preferences),
		exists: (id) => readNode(queryClient, id) !== undefined,
	});
	const starredIds = stars.flatMap((star) => (star.nodeId !== null && star.query === null ? [star.nodeId] : []));
	const results: PickerResult[] = hits.map(({id, labelHtml}) => ({id, labelHtml}));
	const listedIds = [...new Set([...recentIds, ...starredIds])];
	const chains = useQueries({
		queries: listedIds.map((id) => ({
			queryKey: nodeKeys.ancestors(id),
			queryFn: async () => fetchAncestors(id),
		})),
	});
	const crumbsById = new Map<string, readonly LocationCrumb[]>([
		...listedIds.map((id, index): [string, readonly LocationCrumb[]] => [
			id,
			ancestorCrumbs(chains[index]?.data ?? []),
		]),
		...hits.map((hit): [string, readonly LocationCrumb[]] => [hit.id, hit.ancestors]),
	]);
	const rows = buildPickerRows({
		query: state.query,
		results,
		recentIds,
		starredIds,
		forItemId: picker.forItemId,
		expanded: state.expanded,
		recentLabel: "create" in defaultLocation ? "Notes" : escapeHtml(nameOf(defaultLocation.id)),
		labelOf: (id) => escapeHtml(nameOf(id)),
	});

	const defaultTarget = async () =>
		"create" in defaultLocation ? ensureNotesLocation(queryClient) : defaultLocation.id;

	const subAction = async (parentId: string | undefined, name: string) => {
		const parent = parentId ?? (await defaultTarget());
		const createdId = crypto.randomUUID();
		await runInUndoBatch(captureOutlineView, () => {
			recentLocations().add(parent);
			createNode.mutate({id: createdId, parent_id: parent, name, index: 0});
		});
		closeLocationPicker({createdId});
	};

	const run = (effect: PickerEffect) => {
		if (effect.type === "close") {
			closeLocationPicker(undefined);
		} else if (effect.type === "action") {
			closeLocationPicker({id: effect.id});
		} else if (effect.type === "sub-action") {
			void subAction(effect.id, effect.name);
		}
	};

	const dispatch = (event: PickerEvent) => {
		const transition = reducePicker(state, event, rows);
		setState(transition.state);
		run(transition.effect);
	};

	const crumbsOf = (id: string): readonly LocationCrumb[] => crumbsById.get(id) ?? [];
	return (
		<LocationPicker
			position={[picker.anchor.x, picker.anchor.y + 4]}
			step={state.step}
			headerText={picker.headerText}
			name={state.name}
			query={state.query}
			onQueryChange={(query) => {
				dispatch({type: "query", query});
			}}
			rows={rows}
			crumbsOf={crumbsOf}
			active={state.active}
			onSelect={(_row, index) => {
				dispatch({type: "select", index});
			}}
			onEscape={() => {
				dispatch({type: "key", key: "Escape"});
			}}
			onFocusLeave={() => {
				dispatch({type: "focus-leave"});
			}}
		/>
	);
}

/** The one inline location picker root, shown wherever `openLocationPicker` opened it. */
export function LocationPickerHost() {
	const picker = useOutlineStore((state) => state.locationPicker);
	if (picker === null) {
		return null;
	}
	return <LocationPickerSession key={`${picker.forItemId}:${picker.anchor.x}:${picker.anchor.y}`} picker={picker} />;
}
