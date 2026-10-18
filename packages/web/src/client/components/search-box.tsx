import {useState} from "react";
import type {CSSProperties, KeyboardEvent} from "react";
import {useMediaQuery} from "../hooks/use-media-query.js";
import {useOutlineStore} from "../stores/outline.js";
import {Tooltip} from "./tooltip.js";

const LABEL_CLASS = "relative shrink-0 max-w-[60vw] transition-[width] duration-300 ease-base searchBox";
const INPUT_BASE_CLASS =
	"m-0 w-full py-[7px] pl-[30px] box-border font-[inherit] leading-[16px] border-transparent rounded-[16px] bg-transparent placeholder:text-primary";
const INPUT_CLASS = `${INPUT_BASE_CLASS} pr-[72px] searchBoxInput`;
const COMPACT_INPUT_CLASS = `${INPUT_BASE_CLASS} transition-opacity duration-[400ms] ease-base searchBoxInput`;
const FOCUSED_INNER_CLASS =
	"flex items-center after:content-[''] after:absolute after:z-1 after:top-full after:left-[5%] after:right-[5%] after:bottom-0 after:-mt-px after:h-px";

const MAGNIFIER_PATH =
	"M384 208A176 176 0 1 0 32 208a176 176 0 1 0 352 0zM343.3 366C307 397.2 259.7 416 208 416C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208c0 51.7-18.8 99-50 135.3L507.3 484.7c6.2 6.2 6.2 16.4 0 22.6s-16.4 6.2-22.6 0L343.3 366z";
const CLEAR_PATH =
	"M14 7C14 10.866 10.8662 14 7 14C3.13379 14 0 10.866 0 7C0 3.134 3.13379 0 7 0C10.8662 0 14 3.134 14 7ZM5.03027 3.96967C4.7373 3.67679 4.2627 3.67679 3.96973 3.96967C3.67676 4.26257 3.67676 4.73743 3.96973 5.03033L5.93945 7L3.96973 8.96967C3.67676 9.26257 3.67676 9.73743 3.96973 10.0303C4.2627 10.3232 4.7373 10.3232 5.03027 10.0303L7 8.06067L8.96973 10.0303C9.2627 10.3232 9.7373 10.3232 10.0303 10.0303C10.3232 9.73743 10.3232 9.26257 10.0303 8.96967L8.06055 7L10.0303 5.03033C10.3232 4.73743 10.3232 4.26257 10.0303 3.96967C9.7373 3.67679 9.2627 3.67679 8.96973 3.96967L7 5.93933L5.03027 3.96967Z";

function borderStyle(color: string): CSSProperties {
	const side = `var(--wf-border-width-s) solid ${color}`;
	return {borderRadius: 20, borderTop: side, borderRight: side, borderLeft: side, borderBottom: side};
}

/**
 * Upstream header search box (label.searchBox): a 210px pill that widens to 320px on focus and
 * collapses to a borderless 36px circle with a plain magnifier below 1000px while empty and unfocused.
 */
export function SearchBox() {
	const searchInput = useOutlineStore((state) => state.searchInput);
	const setSearchInput = useOutlineStore((state) => state.setSearchInput);
	const focused = useOutlineStore((state) => state.searchFocused);
	const setSearchFocused = useOutlineStore((state) => state.setSearchFocused);
	const openSearchWithQuery = useOutlineStore((state) => state.openSearchWithQuery);
	const wide = useMediaQuery("(min-width: 1000px)");
	const [armed, setArmed] = useState(false);

	const hasText = searchInput !== "";
	const collapsed = !wide && !focused && !hasText;

	const labelStyle: CSSProperties = collapsed
		? {width: 36, height: 36, borderRadius: 18}
		: {marginRight: 6, width: focused ? 320 : 210};
	const innerStyle: CSSProperties = {
		...(collapsed
			? {borderRadius: 20}
			: borderStyle(hasText ? "var(--wf-border-tint)" : "var(--wf-border-primary)")),
		...(focused
			? {
					borderRadius: "20px 20px 0 0",
					borderBottom: "1px solid transparent",
					background: "var(--wf-background-primary)",
				}
			: {}),
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			openSearchWithQuery(searchInput);
		}
	};

	const label = (
		// oxlint-disable-next-line jsx-a11y/label-has-associated-control -- upstream's bare label wraps the input; its placeholder names it
		<label className={collapsed ? `${LABEL_CLASS} hover:!bg-tertiary` : LABEL_CLASS} style={labelStyle}>
			<div className={focused ? FOCUSED_INNER_CLASS : "flex items-center "} style={innerStyle}>
				<div className="hidden" />
				<input
					autoComplete="off"
					autoCorrect="off"
					className={
						wide
							? INPUT_CLASS
							: collapsed
								? `${COMPACT_INPUT_CLASS} opacity-0 cursor-pointer`
								: COMPACT_INPUT_CLASS
					}
					data-handbook="search.search"
					id="srch-input"
					onBlur={() => {
						setSearchFocused(false);
					}}
					onChange={(event) => {
						setSearchInput(event.target.value);
					}}
					onFocus={() => {
						setArmed(true);
						setSearchFocused(true);
					}}
					onKeyDown={handleKeyDown}
					placeholder="Search"
					readOnly={!armed}
					type="text"
					value={searchInput}
				/>
				<svg
					className={`svg-inline--fa fa-magnifying-glass ${collapsed ? "fa-1x absolute left-[10px] pt-xs" : "fa-sm absolute left-ml"} pointer-events-none`}
					data-icon="magnifying-glass"
					viewBox="0 0 512 512"
				>
					<path d={MAGNIFIER_PATH} fill="currentColor" />
				</svg>
				<div className="absolute top-0 right-[11px] h-full flex items-center justify-center">
					{hasText && (
						// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- upstream's clear control is a bare svg
						<svg
							width="14"
							height="14"
							viewBox="0 0 14 14"
							className="cursor-pointer text-secondary"
							onClick={() => {
								setSearchInput("");
							}}
						>
							<path clipRule="evenodd" d={CLEAR_PATH} fill="currentColor" fillRule="evenodd" />
						</svg>
					)}
				</div>
			</div>
		</label>
	);

	return <div className="flex items-center">{collapsed ? <Tooltip content="Search">{label}</Tooltip> : label}</div>;
}
