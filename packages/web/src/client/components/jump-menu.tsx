import {useQueries, useQueryClient} from "@tanstack/react-query";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {KeyboardEvent, UIEvent} from "react";
import {useStableNavigate} from "../hooks/use-stable-navigate.js";
import {isMacPlatform} from "../editable-text-keys.js";
import {mostRecent} from "@workflowy/shared";
import type {Star} from "@workflowy/shared";
import {stripHtmlTags} from "@workflowy/shared/html";
import type {SwitcherResponse, SwitcherResult} from "../../server/switcher-search.js";
import {fetchAncestors} from "../hooks/use-nodes.js";
import {readLastViewed, useStars} from "../hooks/use-starred.js";
import {locationUrl} from "../location.js";
import {nodeKeys, readNode} from "../node-cache.js";
import {readJson} from "../read-json.js";
import {applySpecial, isSpecialFilter, specialRows, switcherCrumb} from "../switcher-model.js";
import type {SpecialRow} from "../switcher-model.js";
import {nearScrollEnd, onSwitcherStep, stepSelection, switcherKeyAction} from "../switcher-keys.js";
import {buildSwitcherRows, starredNodeIds} from "../switcher-rows.js";
import type {StarredEntry, SwitcherRow, SwitcherSearchStatus} from "../switcher-rows.js";
import {useOutlineStore} from "../stores/outline.js";
import {useZoomTo} from "../hooks/use-zoom-to.js";
import {FaIcon} from "./fa-icons.js";
import {LoadingSpinner} from "./loading-spinner.js";

const BACKDROP_CLASS =
	"fixed top-sat left-sal right-sar bottom-sab flex items-start justify-center print:hidden dialog-backdrop";

const SCRIM_CLASS =
	"absolute inset-0 flex items-center justify-center bg-black transition-opacity duration-300 transition-base";

// Upstream WF.DomKit.Dialog box.
const DIALOG_CLASS =
	"wf-dialog dialog-box relative mt-[10vh] p-0 !w-[calc(100%-72px)] max-w-[576px] max-h-[80vh] shrink-0 gap-l flex flex-col rounded-m border border-solid border-primary text-primary bg-primary box-border select-text overflow-x-hidden overflow-y-auto overscroll-contain transition-[transform,opacity] duration-300 transition-base desktop:shadow-[var(--wf-box-shadow-m)] mobile:max-w-full mobile:border-0 mobile:!w-[100%] [@media(max-height:700px)]:!mt-0 [@media(max-height:700px)]:!h-full [@media(max-height:700px)]:max-h-none [@media(max-height:700px)]:!rounded-none [@media(max-width:576px)]:mt-0 [@media(max-width:576px)]:!w-full [@media(max-width:576px)]:h-full [@media(max-width:576px)]:max-h-none [@media(max-width:576px)]:!rounded-none [@media(max-width:576px)]:border-none";

// Upstream WF.DomKit.Input with the switcher's py-ml px-l padding.
const INPUT_CLASS =
	"block w-full box-border appearance-none p-m rounded-s py-ml px-l outline-none border border-solid border-primary bg-primary focus:border-tint text-s leading-s text-primary placeholder:text-tertiary selection:bg-selected [&:-webkit-autofill]:shadow-[0_0_0_1000px_#e4f5ff_inset] [&:-webkit-autofill]:[-webkit-text-fill-color:inherit] [&:-webkit-autofill]:border-tint [&:-webkit-autofill:hover]:shadow-[0_0_0_1000px_#e4f5ff_inset] [&:-webkit-autofill:focus]:shadow-[0_0_0_1000px_#e4f5ff_inset] [&:autofill]:shadow-[0_0_0_1000px_#e4f5ff_inset] [&:autofill:hover]:shadow-[0_0_0_1000px_#e4f5ff_inset] [&:autofill:focus]:shadow-[0_0_0_1000px_#e4f5ff_inset]";

const SEARCH_LIMIT = 20;

/** One page of `/api/search/switcher`; throws on a failed answer. */
async function fetchSwitcherPage(body: {
	query: string;
	offset?: number;
	limit: number;
	starredIds: string[];
}): Promise<SwitcherResponse> {
	const response = await fetch("/api/search/switcher", {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		throw new Error(`Switcher search failed: ${response.status}`);
	}
	return readJson<SwitcherResponse>(response);
}

/** How long later keystrokes wait for the typing to pause before searching. */
const SEARCH_DEBOUNCE_MS = 150;

/** How long the opening's first search may take before the indexing message shows. */
const SLOW_FIRST_SEARCH_MS = 300;

const NO_SPECIALS: readonly SpecialRow[] = [];

function optionClass(hasCrumbs: boolean, selected: boolean): string {
	return [
		"switcher-option grid grid-cols-[auto_1fr] gap-x-m",
		hasCrumbs ? "grid-rows-[auto_auto] gap-y-xs pb-ml" : "grid-rows-[auto] gap-y-xs pb-m",
		selected ? "bg-secondary" : "",
		"pt-m px-l items-center cursor-pointer overflow-hidden whitespace-nowrap rounded-s",
	]
		.filter(Boolean)
		.join(" ");
}

interface SwitcherOptionProps {
	row: SwitcherRow;
	selected: boolean;
	onSelect: () => void;
	onHover: () => void;
}

/** One `.switcher-option` row: star cell, highlighted label, then the ancestor crumbs when there are any. */
function SwitcherOption({row, selected, onSelect, onHover}: SwitcherOptionProps) {
	const struck = row.completed && !selected;
	const hasCrumbs = row.ancestors.length > 0;
	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- upstream rows are plain divs; the input owns the keyboard
		<div className={optionClass(hasCrumbs, selected)} onClick={onSelect} onMouseMove={onHover}>
			<div className="w-4">
				{row.query === null ? (
					row.starred && <FaIcon icon="fas:star" className="text-spark" />
				) : (
					<FaIcon icon="fas:magnifying-glass" />
				)}
			</div>
			<div
				className={`items-center ${struck ? "line-through opacity-[0.37] " : ""}text-base leading-base truncate`}
			>
				<div className="flex justify-between items-center">
					<div className="overflow-hidden mr-m">
						<span dangerouslySetInnerHTML={{__html: row.labelHtml}} />
					</div>
				</div>
			</div>
			{hasCrumbs && (
				<>
					<div className="w-4" />
					<div
						className={`${struck ? "line-through " : ""}hover:no-underline leading-base opacity-60 truncate`}
					>
						{row.ancestors.map((ancestor) => (
							<span key={ancestor.id}>
								{switcherCrumb(ancestor.name)}
								<FaIcon icon="fal:chevron-right" className="px-s" />
							</span>
						))}
					</div>
				</>
			)}
		</div>
	);
}

interface SpecialOptionProps {
	row: SpecialRow;
	selected: boolean;
	onSelect: () => void;
	onHover: () => void;
}

/** A `..` or `-` row: a plain label with no star, crumbs or action buttons. */
function SpecialOption({row, selected, onSelect, onHover}: SpecialOptionProps) {
	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- upstream rows are plain divs; the input owns the keyboard
		<div className={optionClass(false, selected)} onClick={onSelect} onMouseMove={onHover}>
			<div className="w-4" />
			<div className="items-center text-base leading-base truncate">
				<div className="flex justify-between items-center">
					<div className="overflow-hidden mr-m">
						<span>{row.label}</span>
					</div>
				</div>
			</div>
		</div>
	);
}

export interface SwitcherDialogProps {
	query: string;
	/** The `..` / `-` rows, listed before `rows`; `selectedIndex` counts them first. */
	specials?: readonly SpecialRow[];
	rows: readonly SwitcherRow[];
	selectedIndex: number;
	/** Plain text shown after the list, or null for none. */
	emptyText: string | null;
	/** Show a spinner after the empty-state text while the first search is pending. */
	indexing: boolean;
	onQueryChange: (query: string) => void;
	onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
	onSelect: (row: SwitcherRow) => void;
	onSelectSpecial?: (row: SpecialRow) => void;
	onHover: (index: number) => void;
	onClose: () => void;
	/** The dialog scrolled within 300px of its bottom: time to load the next page. */
	onScrollNearEnd: () => void;
}

/** Upstream's switcher dialog DOM: backdrop, scrim, dialog box with the input, close icon and option list. */
export function SwitcherDialog({
	query,
	specials = NO_SPECIALS,
	rows,
	selectedIndex,
	emptyText,
	indexing,
	onQueryChange,
	onKeyDown,
	onSelect,
	onSelectSpecial,
	onHover,
	onClose,
	onScrollNearEnd,
}: SwitcherDialogProps) {
	return (
		<div className={BACKDROP_CLASS} style={{zIndex: 600}}>
			{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Escape in the input closes too */}
			<div className={SCRIM_CLASS} style={{opacity: 0.2}} onClick={onClose} />
			<div
				className={DIALOG_CLASS}
				onScroll={(event: UIEvent<HTMLDivElement>) => {
					if (nearScrollEnd(event.currentTarget)) {
						onScrollNearEnd();
					}
				}}
			>
				<div className="p-m flex flex-col gap-m text-s">
					<div className="flex flex-col w-full">
						<input
							className={INPUT_CLASS}
							type="text"
							placeholder="Jump to..."
							value={query}
							// oxlint-disable-next-line jsx-a11y/no-autofocus -- opening the jump menu is a request to type a query
							autoFocus
							onChange={(event) => {
								onQueryChange(event.target.value);
							}}
							onKeyDown={onKeyDown}
						/>
					</div>
					<FaIcon
						icon="fas:circle-xmark"
						size="lg"
						className="absolute right-[20px] top-[21px] cursor-pointer text-tertiary"
						onClick={onClose}
					/>
					<div className="flex flex-col gap-s">
						{specials.map((row, index) => (
							<SpecialOption
								key={`special-${row.kind}`}
								row={row}
								selected={index === selectedIndex}
								onSelect={() => {
									onSelectSpecial?.(row);
								}}
								onHover={() => {
									onHover(index);
								}}
							/>
						))}
						{rows.map((row, index) => (
							<SwitcherOption
								key={row.key}
								row={row}
								selected={specials.length + index === selectedIndex}
								onSelect={() => {
									onSelect(row);
								}}
								onHover={() => {
									onHover(specials.length + index);
								}}
							/>
						))}
					</div>
					{emptyText !== null && <div>{emptyText}</div>}
					{indexing && (
						<div style={{margin: "auto", marginTop: 8}}>
							<LoadingSpinner size="small" />
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

/**
 * Upstream's jump menu ("switcher").
 * Opens with Cmd+K and searches the live tree through `POST /api/search/switcher`.
 */
export function JumpMenu() {
	const jumpMenuOpen = useOutlineStore((state) => state.jumpMenuOpen);
	// Mounting the dialog only while open gives every opening fresh state.
	return jumpMenuOpen ? <JumpMenuDialog /> : null;
}

function safeLastViewed(): Record<string, number> {
	try {
		return readLastViewed(globalThis.localStorage);
	} catch {
		return {};
	}
}

/** Starred locations in `mostRecent` order with their nodes' text and crumbs from the ancestors query. */
function useStarredEntries(stars: readonly Star[]): readonly StarredEntry[] {
	const ordered = useMemo(() => mostRecent(stars, safeLastViewed()), [stars]);
	const nodeIds = useMemo(() => starredNodeIds(ordered), [ordered]);
	const ancestorQueries = useQueries({
		queries: nodeIds.map((nodeId) => ({
			queryKey: nodeKeys.ancestors(nodeId),
			queryFn: async () => fetchAncestors(nodeId),
		})),
	});
	return ordered.map((star): StarredEntry => {
		const chain = star.nodeId === null ? [] : (ancestorQueries[nodeIds.indexOf(star.nodeId)]?.data ?? []);
		const self = chain.at(-1);
		return {
			star,
			name: self?.name ?? star.name ?? "",
			note: self?.note ?? "",
			completed: (self?.completedAt ?? null) !== null,
			ancestors: chain.slice(0, -1).map((node) => ({id: node.id, name: stripHtmlTags(node.name ?? "")})),
		};
	});
}

function JumpMenuDialog() {
	const closeJumpMenu = useOutlineStore((state) => state.closeJumpMenu);
	const cancel = useCallback(() => {
		closeJumpMenu("cancel");
	}, [closeJumpMenu]);
	const zoomTo = useZoomTo();
	const queryClient = useQueryClient();
	const zoomedNodeId = useOutlineStore((state) => state.zoomedNodeId);
	const {stars} = useStars();
	const starred = useStarredEntries(stars);
	const [query, setQuery] = useState("");
	// Upstream quirk: `..` and `-` have no words, so the list below them keeps the last real filter's results.
	const [listQuery, setListQuery] = useState("");
	const [results, setResults] = useState<readonly SwitcherResult[]>([]);
	const [hasMore, setHasMore] = useState(false);
	const loadingMore = useRef(false);
	const latestQuery = useRef("");
	const [status, setStatus] = useState<SwitcherSearchStatus>("idle");
	const answered = useRef(false);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const navigate = useStableNavigate();

	const starredIds = useMemo(
		() => stars.flatMap((star) => (star.nodeId !== null && !star.query ? [star.nodeId] : [])),
		[stars],
	);

	const handleQueryChange = useCallback((value: string) => {
		setQuery(value);
		setSelectedIndex(0);
		if (!isSpecialFilter(value)) {
			setListQuery(value);
			latestQuery.current = value;
		}
	}, []);

	useEffect(() => {
		if (!listQuery.trim()) {
			// oxlint-disable-next-line unicorn/no-useless-undefined -- consistent-return needs a value beside the cleanup return
			return undefined;
		}
		let cancelled = false;
		const runSearch = async () => {
			try {
				const data = await fetchSwitcherPage({query: listQuery, limit: SEARCH_LIMIT, starredIds});
				if (!cancelled) {
					answered.current = true;
					setResults(data.results);
					setHasMore(data.hasMore);
					setSelectedIndex(0);
					setStatus("done");
				}
			} catch {
				if (!cancelled) {
					// An error answers too, so the slow-search timer cannot replace it with the indexing message.
					answered.current = true;
					setResults([]);
					setHasMore(false);
					setStatus("error");
				}
			}
		};
		// The opening's first search goes out at once; later keystrokes wait for the typing to pause.
		const searchTimeout = setTimeout(
			() => {
				void runSearch();
			},
			answered.current ? SEARCH_DEBOUNCE_MS : 0,
		);
		// Upstream's indexing message only for a first answer slow enough to notice, not on every opening.
		const slowTimeout = answered.current
			? undefined
			: setTimeout(() => {
					if (!answered.current) {
						setStatus("pending");
					}
				}, SLOW_FIRST_SEARCH_MS);
		return () => {
			cancelled = true;
			clearTimeout(searchTimeout);
			clearTimeout(slowTimeout);
		};
	}, [listQuery, starredIds]);

	const {rows, emptyText, indexing} = buildSwitcherRows(starred, {status, results}, listQuery);

	const zoomedNode = zoomedNodeId === null ? undefined : readNode(queryClient, zoomedNodeId);
	const zoomedName = zoomedNodeId === null ? "Home" : stripHtmlTags(zoomedNode?.name ?? "");
	const specials = specialRows(query, {zoomId: zoomedNodeId, parentId: zoomedNode?.parent_id ?? null});

	/** Upstream `..` / `-`: remember where we were, then go to the row's page like any other jump. */
	const handleSelectSpecial = useCallback(
		(row: SpecialRow) => {
			closeJumpMenu("navigate");
			void zoomTo(applySpecial(row, {id: zoomedNodeId, name: zoomedName}), "first_child");
		},
		[closeJumpMenu, zoomTo, zoomedName, zoomedNodeId],
	);

	/** Upstream: close without restoring, go to the row, then edit its first child (or the zoom-root title). */
	const handleSelect = useCallback(
		(row: SwitcherRow) => {
			closeJumpMenu("navigate");
			if (row.query === null) {
				void zoomTo(row.nodeId, "first_child");
			} else {
				void navigate(locationUrl({id: row.nodeId, query: row.query}));
			}
		},
		[closeJumpMenu, navigate, zoomTo],
	);

	const rowCount = specials.length + rows.length;
	useEffect(
		() =>
			onSwitcherStep((step) => {
				setSelectedIndex((previous) => stepSelection(previous, rowCount, step));
			}),
		[rowCount],
	);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLInputElement>) => {
			const action = switcherKeyAction(event, isMacPlatform());
			if (action === null) {
				return;
			}
			event.preventDefault();
			switch (action) {
				case "close": {
					cancel();
					break;
				}
				case "next":
				case "prev": {
					setSelectedIndex((previous) => stepSelection(previous, rowCount, action));
					break;
				}
				case "enter": {
					const special = specials[selectedIndex];
					const selected = rows[selectedIndex - specials.length];
					if (special !== undefined) {
						handleSelectSpecial(special);
					} else if (selected !== undefined) {
						handleSelect(selected);
					}
					break;
				}
			}
		},
		[cancel, handleSelect, handleSelectSpecial, rowCount, rows, selectedIndex, specials],
	);

	/** Upstream's infinite scroll: append the next page of server results. */
	const loadMore = useCallback(() => {
		if (!hasMore || loadingMore.current || !listQuery.trim()) {
			return;
		}
		loadingMore.current = true;
		const nextPage = fetchSwitcherPage({query: listQuery, offset: results.length, limit: SEARCH_LIMIT, starredIds});
		void nextPage
			.then((data) => {
				// A page for a query the user has since changed is dropped.
				if (latestQuery.current === listQuery) {
					setResults((previous) => [...previous, ...data.results]);
					setHasMore(data.hasMore);
				}
				return data;
			})
			.catch(() => {
				// A failed page leaves the list as it is; the next scroll to the end asks again.
			})
			.finally(() => {
				loadingMore.current = false;
			});
	}, [hasMore, listQuery, results.length, starredIds]);

	return (
		<SwitcherDialog
			query={query}
			specials={specials}
			rows={rows}
			selectedIndex={selectedIndex}
			emptyText={emptyText}
			indexing={indexing}
			onQueryChange={handleQueryChange}
			onKeyDown={handleKeyDown}
			onSelect={handleSelect}
			onSelectSpecial={handleSelectSpecial}
			onHover={setSelectedIndex}
			onClose={cancel}
			onScrollNearEnd={loadMore}
		/>
	);
}
