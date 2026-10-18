/** Upstream's zoom transition length. */
export const ZOOM_MS = 200;
/** Fallback for each transition's `transitionend`. */
const TRANSITION_FALLBACK_MS = 300;
/** The body class upstream's `[.item--zooming-in-progress_&]` utilities key on. */
export const ZOOMING_CLASS = "item--zooming-in-progress";

export interface Offset {
	dx: number;
	dy: number;
}

/**
 * Upstream's moveBullets offset from the moving row `L` to the other row `b`: the bullet indent (36px) comes off
 * the horizontal distance and the title's drop (20px) is added to the vertical one.
 */
export function zoomOffset(from: {left: number; top: number}, to: {left: number; top: number}): Offset {
	return {dx: to.left - from.left - 36, dy: to.top - from.top + 20};
}

/** Upstream skips the zoom animation on mobile, when either side is a board, and under reduced motion. */
export function zoomAnimationAllowed(env: {mobile: boolean; board: boolean; reducedMotion: boolean}): boolean {
	return !env.mobile && !env.board && !env.reducedMotion;
}

interface Look {
	opacity: string;
	transform: string;
}

interface Phase {
	from: Look;
	to: Look;
}

export interface ZoomPhases {
	/** The moving row's `.name` and `.notes`. */
	row: Phase;
	/** The moving row's child rows. */
	children: Phase;
	/** The rows beside the moving row, off the zoom path. */
	siblings: Phase;
	/** The crossfade clone of the title. */
	title: Phase;
}

/** Each element group's start and end look for a zoom in or out: zooming out plays zooming in backwards. */
export function zoomPhases(isOut: boolean, {dx, dy}: Offset): ZoomPhases {
	const shown: Look = {opacity: "1", transform: ""};
	const hidden: Look = {opacity: "0", transform: ""};
	const away: Look = {opacity: "0", transform: `translate(${dx}px, ${dy}px)`};
	const phase = (inFrom: Look, inTo: Look): Phase => (isOut ? {from: inTo, to: inFrom} : {from: inFrom, to: inTo});
	return {
		row: phase(shown, away),
		children: phase(away, shown),
		siblings: phase(shown, hidden),
		title: phase(shown, hidden),
	};
}

interface AnimateZoomInput {
	isOut: boolean;
	/** The moving row `L`: the target row when zooming in, the row zoomed out of when zooming out. */
	rowEl: HTMLElement;
	/** The other row `b`: the title row. */
	otherEl: HTMLElement;
	childEls: HTMLElement[];
}

const CLONE_FONT_PROPS = [
	"font-size",
	"font-family",
	"font-weight",
	"font-style",
	"color",
	"letter-spacing",
	"line-height",
] as const;

function nameContent(row: HTMLElement): HTMLElement | null {
	return row.querySelector<HTMLElement>(":scope > .name > .content");
}

/** A copy of `.name > .content` on `<body>`, positioned over the original with its font copied inline. */
function contentClone(content: HTMLElement): HTMLElement {
	const rect = content.getBoundingClientRect();
	const computed = getComputedStyle(content);
	const clone = content.cloneNode(true);
	if (!(clone instanceof HTMLElement)) {
		throw new TypeError("cloned content is not an element");
	}
	for (const prop of CLONE_FONT_PROPS) {
		clone.style.setProperty(prop, computed.getPropertyValue(prop));
	}
	Object.assign(clone.style, {
		maxWidth: `${rect.width}px`,
		padding: "0",
		margin: "0",
		zIndex: "1000",
		position: "absolute",
		left: `${rect.left + globalThis.scrollX}px`,
		top: `${rect.top + globalThis.scrollY}px`,
		transformOrigin: "0 20%",
		pointerEvents: "none",
	});
	document.body.append(clone);
	return clone;
}

interface Step {
	el: HTMLElement;
	from: Look;
	to: Look;
}

async function waitForTransition(el: HTMLElement): Promise<void> {
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			el.removeEventListener("transitionend", done);
			resolve();
		};
		const timer = setTimeout(done, TRANSITION_FALLBACK_MS);
		el.addEventListener("transitionend", done);
	});
}

/** Put every element at its start look, then transition them all to their end looks. */
async function play(steps: Step[]): Promise<void> {
	for (const {el, from} of steps) {
		el.style.transition = "none";
		el.style.opacity = from.opacity;
		el.style.transform = from.transform;
	}
	// Flush the start looks so the transitions run from them.
	document.body.getBoundingClientRect();
	for (const {el, to} of steps) {
		el.style.transition = `opacity ${ZOOM_MS}ms, transform ${ZOOM_MS}ms`;
		el.style.opacity = to.opacity;
		el.style.transform = to.transform;
	}
	await Promise.all(steps.map(async ({el}) => waitForTransition(el)));
}

/**
 * Upstream's zoom animation, in parallel: a crossfade of `.name > .content` clones (the moving row's text slides
 * and scales between its row and the title while the title fades), and moveBullets (the moving row's bullet and
 * note slide by the offset and fade, its children slide the other way, and its siblings fade). The real contents
 * are hidden meanwhile; every inline style and clone is cleared afterwards.
 */
async function animateZoom({isOut, rowEl, otherEl, childEls}: AnimateZoomInput): Promise<void> {
	const rowName = rowEl.querySelector<HTMLElement>(":scope > .name");
	const titleName = otherEl.querySelector<HTMLElement>(":scope > .name");
	const rowContent = nameContent(rowEl);
	const titleContent = nameContent(otherEl);
	if (rowName === null || titleName === null || rowContent === null || titleContent === null) {
		return;
	}
	const phases = zoomPhases(isOut, zoomOffset(rowName.getBoundingClientRect(), titleName.getBoundingClientRect()));

	const rowRect = rowContent.getBoundingClientRect();
	const titleRect = titleContent.getBoundingClientRect();
	const rowFont = Number(getComputedStyle(rowContent).fontSize.replace("px", "")) || 16;
	const titleFont = Number(getComputedStyle(titleContent).fontSize.replace("px", "")) || rowFont;
	const atTitle = `translate(${titleRect.left - rowRect.left}px, ${titleRect.top - rowRect.top}px) scale(${titleFont / rowFont})`;
	const atRow = "";

	const movingClone = contentClone(rowContent);
	const titleClone = contentClone(titleContent);
	rowContent.style.visibility = "hidden";
	titleContent.style.visibility = "hidden";

	const rowParts = [rowName, rowEl.querySelector<HTMLElement>(":scope > .notes")].filter(
		(el): el is HTMLElement => el !== null,
	);
	const siblings = [...(rowEl.parentElement?.children ?? [])].filter(
		(el): el is HTMLElement => el instanceof HTMLElement && el !== rowEl && el.classList.contains("project"),
	);
	const steps: Step[] = [
		{
			el: movingClone,
			from: {opacity: "1", transform: isOut ? atTitle : atRow},
			to: {opacity: "1", transform: isOut ? atRow : atTitle},
		},
		{el: titleClone, ...phases.title},
		...rowParts.map((el) => ({el, ...phases.row})),
		...childEls.map((el) => ({el, ...phases.children})),
		...siblings.map((el) => ({el, ...phases.siblings})),
	];
	try {
		await play(steps);
	} finally {
		movingClone.remove();
		titleClone.remove();
		rowContent.style.visibility = "";
		titleContent.style.visibility = "";
		for (const {el} of steps) {
			el.style.transition = "";
			el.style.opacity = "";
			el.style.transform = "";
		}
	}
}

/** The outline row showing `nodeId` (its `.project`), or null when it is not rendered. */
function zoomRowElement(nodeId: string): HTMLElement | null {
	const bullet = document.querySelector(`.project > .name > a.bullet[data-item-id="${CSS.escape(nodeId)}"]`);
	return bullet?.closest<HTMLElement>(".project") ?? null;
}

/** The zoom root's title row. */
function zoomTitleElement(): HTMLElement | null {
	return document.querySelector<HTMLElement>(".project.root");
}

/** Whether this browser should play the zoom animation; `board` says if either side is a board. */
export function zoomAnimationEnabled(board: boolean): boolean {
	return zoomAnimationAllowed({
		mobile: document.body.classList.contains("is-mobile"),
		board,
		reducedMotion: globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
	});
}

/**
 * Play the zoom animation between `rowId`'s row and the title. Does nothing when either row is not rendered. The
 * caller owns the body's zooming class, since zooming in keeps it until the new view is pushed.
 */
export async function runZoomAnimation(isOut: boolean, rowId: string): Promise<void> {
	const rowEl = zoomRowElement(rowId);
	const otherEl = zoomTitleElement();
	if (rowEl === null || otherEl === null) {
		return;
	}
	const childEls = [...rowEl.querySelectorAll<HTMLElement>(":scope > .children > .project")];
	await animateZoom({isOut, rowEl, otherEl, childEls});
}

/** Upstream's 300ms fallback, in frames: how long a zoom out waits for the new view to render the row. */
const ROW_WAIT_FRAMES = 18;

/** Resolve once `nodeId`'s row is rendered (a just-navigated view mounts a few frames later), or after ~300ms. */
export async function waitForZoomRow(nodeId: string): Promise<void> {
	for (let frame = 0; frame < ROW_WAIT_FRAMES && zoomRowElement(nodeId) === null; frame++) {
		// oxlint-disable-next-line no-await-in-loop -- each frame must paint before the next check
		await new Promise((resolve) => {
			requestAnimationFrame(resolve);
		});
	}
}
