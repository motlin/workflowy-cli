import {useCallback, useEffect, useMemo, useState} from "react";
import type {KeyboardEvent} from "react";
import {useNavigate} from "react-router-dom";
import type {SwitcherResponse, SwitcherResult} from "../../server/switcher-search.js";
import {useStars} from "../hooks/use-starred.js";
import {nodeUrl} from "../navigation.js";
import {readJson} from "../read-json.js";
import {switcherCrumb} from "../switcher-model.js";
import {useOutlineStore} from "../stores/outline.js";
import {FaIcon} from "./fa-icons.js";

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
	row: SwitcherResult;
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
			<div className="w-4">{row.starred && <FaIcon icon="fas:star" className="text-spark" />}</div>
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
	rows: readonly SwitcherResult[];
	selectedIndex: number;
	/** Plain text shown after the list, or null for none. */
	emptyText: string | null;
	onQueryChange: (query: string) => void;
	onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
	onSelect: (row: SwitcherResult) => void;
	onHover: (index: number) => void;
	onClose: () => void;
}

/** Upstream's switcher dialog DOM: backdrop, scrim, dialog box with the input, close icon and option list. */
export function SwitcherDialog({
	query,
	rows,
	selectedIndex,
	emptyText,
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
								key={row.id}
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

type SearchStatus = "idle" | "loading" | "done" | "error";

function JumpMenuDialog() {
	const toggleJumpMenu = useOutlineStore((state) => state.toggleJumpMenu);
	const {stars} = useStars();
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<readonly SwitcherResult[]>([]);
	const [status, setStatus] = useState<SearchStatus>("idle");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const navigate = useNavigate();

	const starredIds = useMemo(
		() => stars.flatMap((star) => (star.nodeId !== null && !star.query ? [star.nodeId] : [])),
		[stars],
	);

	const handleQueryChange = useCallback((value: string) => {
		setQuery(value);
		setSelectedIndex(0);
		if (!value.trim()) {
			setResults([]);
			setStatus("idle");
		}
	}, []);

	useEffect(() => {
		if (!query.trim()) {
			// oxlint-disable-next-line unicorn/no-useless-undefined -- consistent-return needs a value beside the cleanup return
			return undefined;
		}
		let cancelled = false;
		const runSearch = async () => {
			setStatus("loading");
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

	const handleSelect = useCallback(
		(row: SwitcherResult) => {
			toggleJumpMenu();
			void navigate(nodeUrl(row.id));
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
					setSelectedIndex((previous) => Math.min(previous + 1, results.length - 1));
					break;
				}
				case "ArrowUp": {
					event.preventDefault();
					setSelectedIndex((previous) => Math.max(previous - 1, 0));
					break;
				}
				case "Enter": {
					event.preventDefault();
					const selected = results[selectedIndex];
					if (selected !== undefined) {
						handleSelect(selected);
					}
					break;
				}
			}
		},
		[handleSelect, results, selectedIndex, toggleJumpMenu],
	);

	const emptyText =
		status === "error"
			? "Search is unavailable right now."
			: status === "done" && results.length === 0
				? "No matches found. Try adjusting your search."
				: null;

	return (
		<SwitcherDialog
			query={query}
			rows={results}
			selectedIndex={selectedIndex}
			emptyText={emptyText}
			onQueryChange={handleQueryChange}
			onKeyDown={handleKeyDown}
			onSelect={handleSelect}
			onHover={setSelectedIndex}
			onClose={toggleJumpMenu}
		/>
	);
}
