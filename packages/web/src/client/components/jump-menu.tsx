import {useQueries} from "@tanstack/react-query";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {KeyboardEvent} from "react";
import {useNavigate} from "react-router-dom";
import {mostRecent} from "@workflowy/shared";
import type {Star} from "@workflowy/shared";
import {stripHtmlTags} from "@workflowy/shared/html";
import type {SwitcherResponse, SwitcherResult} from "../../server/switcher-search.js";
import {fetchAncestors} from "../hooks/use-nodes.js";
import {readLastViewed, useStars} from "../hooks/use-starred.js";
import {locationUrl} from "../location.js";
import {nodeKeys} from "../node-cache.js";
import {readJson} from "../read-json.js";
import {switcherCrumb} from "../switcher-model.js";
import {buildSwitcherRows} from "../switcher-rows.js";
import type {StarredEntry, SwitcherRow, SwitcherSearchStatus} from "../switcher-rows.js";
import {useOutlineStore} from "../stores/outline.js";
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

export interface SwitcherDialogProps {
	query: string;
	rows: readonly SwitcherRow[];
	selectedIndex: number;
	/** Plain text shown after the list, or null for none. */
	emptyText: string | null;
	/** Show a spinner after the empty-state text while the first search is pending. */
	indexing: boolean;
	onQueryChange: (query: string) => void;
	onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
	onSelect: (row: SwitcherRow) => void;
	onHover: (index: number) => void;
	onClose: () => void;
}

/** Upstream's switcher dialog DOM: backdrop, scrim, dialog box with the input, close icon and option list. */
export function SwitcherDialog({
	query,
	rows,
	selectedIndex,
	emptyText,
	indexing,
	onQueryChange,
	onKeyDown,
	onSelect,
	onHover,
	onClose,
}: SwitcherDialogProps) {
	return (
		<div className={BACKDROP_CLASS} style={{zIndex: 600}}>
			{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Escape in the input closes too */}
			<div className={SCRIM_CLASS} style={{opacity: 0.2}} onClick={onClose} />
			<div className={DIALOG_CLASS}>
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
						{rows.map((row, index) => (
							<SwitcherOption
								key={row.key}
								row={row}
								selected={index === selectedIndex}
								onSelect={() => {
									onSelect(row);
								}}
								onHover={() => {
									onHover(index);
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
	const ancestorQueries = useQueries({
		queries: ordered.map((star) => ({
			queryKey: nodeKeys.ancestors(star.nodeId ?? ""),
			queryFn: async () => (star.nodeId === null ? [] : fetchAncestors(star.nodeId)),
			enabled: star.nodeId !== null,
		})),
	});
	return ordered.map((star, index): StarredEntry => {
		const chain = ancestorQueries[index]?.data ?? [];
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
	const toggleJumpMenu = useOutlineStore((state) => state.toggleJumpMenu);
	const {stars} = useStars();
	const starred = useStarredEntries(stars);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<readonly SwitcherResult[]>([]);
	const [status, setStatus] = useState<SwitcherSearchStatus>("idle");
	const answered = useRef(false);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const navigate = useNavigate();

	const starredIds = useMemo(
		() => stars.flatMap((star) => (star.nodeId !== null && !star.query ? [star.nodeId] : [])),
		[stars],
	);

	const handleQueryChange = useCallback((value: string) => {
		setQuery(value);
		setSelectedIndex(0);
	}, []);

	useEffect(() => {
		if (!query.trim()) {
			// oxlint-disable-next-line unicorn/no-useless-undefined -- consistent-return needs a value beside the cleanup return
			return undefined;
		}
		let cancelled = false;
		const runSearch = async () => {
			if (!answered.current) {
				setStatus("pending");
			}
			try {
				const response = await fetch("/api/search/switcher", {
					method: "POST",
					headers: {"Content-Type": "application/json"},
					body: JSON.stringify({query, limit: SEARCH_LIMIT, starredIds}),
				});
				if (!response.ok) {
					throw new Error(`Switcher search failed: ${response.status}`);
				}
				const data = await readJson<SwitcherResponse>(response);
				if (!cancelled) {
					answered.current = true;
					setResults(data.results);
					setSelectedIndex(0);
					setStatus("done");
				}
			} catch {
				if (!cancelled) {
					setResults([]);
					setStatus("error");
				}
			}
		};
		const searchTimeout = setTimeout(() => {
			void runSearch();
		}, 150);
		return () => {
			cancelled = true;
			clearTimeout(searchTimeout);
		};
	}, [query, starredIds]);

	const {rows, emptyText, indexing} = buildSwitcherRows(starred, {status, results}, query);

	const handleSelect = useCallback(
		(row: SwitcherRow) => {
			toggleJumpMenu();
			void navigate(locationUrl({id: row.nodeId, query: row.query}));
		},
		[navigate, toggleJumpMenu],
	);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLInputElement>) => {
			switch (event.key) {
				case "Escape": {
					event.preventDefault();
					toggleJumpMenu();
					break;
				}
				case "ArrowDown": {
					event.preventDefault();
					setSelectedIndex((previous) => Math.min(previous + 1, rows.length - 1));
					break;
				}
				case "ArrowUp": {
					event.preventDefault();
					setSelectedIndex((previous) => Math.max(previous - 1, 0));
					break;
				}
				case "Enter": {
					event.preventDefault();
					const selected = rows[selectedIndex];
					if (selected !== undefined) {
						handleSelect(selected);
					}
					break;
				}
			}
		},
		[handleSelect, rows, selectedIndex, toggleJumpMenu],
	);

	return (
		<SwitcherDialog
			query={query}
			rows={rows}
			selectedIndex={selectedIndex}
			emptyText={emptyText}
			indexing={indexing}
			onQueryChange={handleQueryChange}
			onKeyDown={handleKeyDown}
			onSelect={handleSelect}
			onHover={setSelectedIndex}
			onClose={toggleJumpMenu}
		/>
	);
}
