/** Upstream's `tn2`: below this window width the page side padding narrows. */
export const PAGE_BREAKPOINT = 720;

/** Upstream's `Ju4`: the clickable blank space after the last row. */
export const DOCUMENT_END_HEIGHT = 380;

/** Upstream's `ln2`: the page's side padding for a window `width`. */
export function getPagePadding(width: number): {left: number; right: number} {
	return width < PAGE_BREAKPOINT ? {left: 56, right: 56} : {left: 80, right: 136};
}

export interface PageStyleInput {
	fullWidth: boolean;
	/** `window.innerWidth`. */
	width: number;
	searching: boolean;
	/** Accepted for parity with upstream; the desktop page never moves while offline. */
	offline?: boolean;
}

/** Upstream's `.page` inline style (desktop). */
export function pageStyle({fullWidth, width, searching}: PageStyleInput) {
	const padding = getPagePadding(width);
	return {
		minHeight: "calc(100vh - 146px)",
		borderRadius: 6,
		maxWidth: fullWidth ? ("none" as const) : 700,
		paddingLeft: padding.left,
		paddingRight: padding.right,
		paddingTop: 24,
		marginTop: 72,
		paddingBottom: searching ? 70 : 24,
	};
}

const PAGE_CLASS =
	"relative mx-auto flex flex-col select-none bg-primary shadow-[0_0_15px_var(--wf-border-ambient)] [-webkit-text-size-adjust:none] print:block page active";

/** Upstream's `.page` class string, plus `searching` and `showCompleted` when they apply. */
export function pageClassName({searching, showCompleted}: {searching: boolean; showCompleted: boolean}): string {
	return [PAGE_CLASS, searching && "searching", showCompleted && "showCompleted"].filter(Boolean).join(" ");
}

/** Upstream's `.pageContainer` class string (desktop). */
export function pageContainerClassName(): string {
	return "min-h-screen bg-[var(--wf-background-ambient)] bg-fixed [background-image:var(--wf-image-ambient)] pageContainer";
}
