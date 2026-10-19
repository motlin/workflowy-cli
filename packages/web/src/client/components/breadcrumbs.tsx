import {useEffect, useMemo, useRef, useState} from "react";
import type {MouseEvent} from "react";
import {createBreadcrumbLayout, measureCrumbLabel} from "../breadcrumb-layout.js";
import type {LayoutCrumb} from "../breadcrumb-layout.js";
import {crumbLabel as formatCrumbLabel} from "../crumb-label.js";
import {useAncestors} from "../hooks/use-nodes.js";
import {nodeUrl, useNodeNavigation} from "../navigation.js";
import {useOutlineStore} from "../stores/outline.js";
import {BreadcrumbSeparator} from "./breadcrumb-separator.js";
import {FaIcon} from "./fa-icons.js";
import {ButtonMenu} from "./flyout/button-menu.js";
import {IconButton} from "./icon-button.js";

export interface Crumb {
	id: string;
	isRoot: boolean;
	name?: string | null;
}

const ROOT_CRUMB: Crumb = {id: "None", isRoot: true};

interface CrumbClickEvent {
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
	button: number;
	preventDefault: () => void;
	stopPropagation: () => void;
}

interface CrumbClickState {
	current: boolean;
	/** A search is committed (`?q=` in the URL). */
	searchActive: boolean;
}

interface CrumbClickDeps {
	navigateToNode: (nodeId: string | null) => void;
	cancelSearch: () => void;
	scrollToTop: () => void;
	focusWindow: () => void;
}

/**
 * Plain clicks focus the window, exit any committed search, navigate in-app and scroll to the top; modified and
 * middle clicks fall through to the anchor's href. The root Home is only clickable during a search, which it exits.
 */
// oxlint-disable-next-line react/only-export-components -- pure click handler exported for tests and reuse by other crumb renderers
export function handleCrumbClick(
	event: CrumbClickEvent,
	crumb: Crumb,
	{current, searchActive}: CrumbClickState,
	{navigateToNode, cancelSearch, scrollToTop, focusWindow}: CrumbClickDeps,
): void {
	if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1) {
		return;
	}
	event.preventDefault();
	const rootDuringSearch = crumb.isRoot && current;
	if (rootDuringSearch) {
		event.stopPropagation();
	}
	focusWindow();
	if (searchActive) {
		cancelSearch();
	}
	if (!rootDuringSearch) {
		navigateToNode(crumb.isRoot ? null : crumb.id);
	}
	scrollToTop();
}

/** Upstream crumbs never take focus on mousedown, so the editor keeps its caret until navigation. */
// oxlint-disable-next-line react/only-export-components -- pure handler exported for tests
export function preventCrumbMouseDown(event: {preventDefault: () => void}): void {
	event.preventDefault();
}

function focusBrowserWindow(): void {
	window.focus();
}

/** Upstream scrolls the window; the local outline scrolls inside `.outline-container`, so reset both. */
function scrollOutlineToTop(): void {
	window.scrollTo(0, 0);
	document.querySelector(".outline-container")?.scrollTo(0, 0);
}

function noop(): void {}

function crumbLabel(name: string | null | undefined): string {
	const label = formatCrumbLabel(name ?? "", {now: new Date()});
	return label === "" ? "Untitled" : label;
}

interface CrumbProps {
	crumb: Crumb;
	current: boolean;
	truncateWidth?: number | null;
	onNavigate: (nodeId: string | null) => void;
	/** A search is committed; enables the root Home so it can exit the search. */
	searchActive?: boolean;
	onCancelSearch?: () => void;
}

/** One upstream `.breadcrumb-item`: an anchor when enabled, a div for the disabled Home at the root. */
export function BreadcrumbItem({
	crumb,
	current,
	truncateWidth,
	onNavigate,
	searchActive = false,
	onCancelSearch = noop,
}: CrumbProps) {
	const disabled = crumb.isRoot && current && !searchActive;
	const className = `breadcrumb-item flex-shrink-0 whitespace-nowrap overflow-hidden truncate ${current ? "current opacity-100" : "opacity-70"}
    data-hj-suppress hover:pointer-fine:opacity-100 hover:pointer-fine:underline cursor-pointer`;
	const content = crumb.isRoot ? (
		<IconButton
			className={`homeButton ${disabled ? "disabled" : ""}`}
			disabled={disabled}
			tooltip="Home"
			data-handbook="nav.home"
		>
			<FaIcon icon="fal:house" size="lg" />
		</IconButton>
	) : (
		crumbLabel(crumb.name)
	);
	const style = {maxWidth: truncateWidth === null ? undefined : truncateWidth};

	if (disabled) {
		return (
			<div className={className} style={style}>
				{content}
			</div>
		);
	}
	return (
		<a
			className={className}
			style={style}
			href={crumb.isRoot ? "/" : nodeUrl(crumb.id)}
			data-item-id={crumb.isRoot ? "None" : crumb.id}
			onMouseDown={preventCrumbMouseDown}
			onClick={(event: MouseEvent<HTMLAnchorElement>) => {
				handleCrumbClick(
					event,
					crumb,
					{current, searchActive},
					{
						navigateToNode: onNavigate,
						cancelSearch: onCancelSearch,
						scrollToTop: scrollOutlineToTop,
						focusWindow: focusBrowserWindow,
					},
				);
			}}
		>
			{content}
		</a>
	);
}

const HOME_LABEL = "Home";
const RESIZE_DEBOUNCE_MS = 200;
const OVERFLOW_MENU_GUTTER = 48;

// Upstream header sizes are the layout defaults; measuring goes through the module export so tests can stub it.
const layout = createBreadcrumbLayout({}, (label) => measureCrumbLabel(label));

interface BreadcrumbOverflowMenuProps {
	items: LayoutCrumb[];
	crumbs: Map<string, Crumb>;
	currentId: string;
	maxWidth: number;
	onNavigate: (nodeId: string | null) => void;
	searchActive?: boolean;
	onCancelSearch?: () => void;
}

/** The ellipsis flyout's body: collapsed crumbs stacked vertically, each in a div, without separators. */
export function BreadcrumbOverflowMenu({
	items,
	crumbs,
	currentId,
	maxWidth,
	onNavigate,
	searchActive,
	onCancelSearch,
}: BreadcrumbOverflowMenuProps) {
	return (
		<div className="flex flex-col items-stretch gap-m px-m breadcrumb-overflow-menu" style={{maxWidth}}>
			{items.map((item) => {
				const crumb = crumbs.get(item.id);
				return crumb === undefined ? null : (
					<div key={item.id}>
						<BreadcrumbItem
							crumb={crumb}
							current={item.id === currentId}
							truncateWidth={item.truncateWidth}
							onNavigate={onNavigate}
							searchActive={searchActive}
							onCancelSearch={onCancelSearch}
						/>
					</div>
				);
			})}
		</div>
	);
}

function initialWindowWidth(): number {
	return typeof window === "undefined" ? Number.POSITIVE_INFINITY : window.innerWidth;
}

/** Upstream tracks the container's `[left, width]` through a ResizeObserver debounced by 200ms. */
function useContainerRect(ref: React.RefObject<HTMLDivElement | null>): [number, number] {
	const [rect, setRect] = useState<[number, number]>(() => [0, initialWindowWidth()]);
	useEffect(() => {
		const element = ref.current;
		if (!element) {
			return () => {};
		}
		let timer: number | undefined;
		const schedule = () => {
			if (timer !== undefined) {
				return;
			}
			timer = window.setTimeout(() => {
				const {left, width} = element.getBoundingClientRect();
				setRect([left, width]);
				timer = undefined;
			}, RESIZE_DEBOUNCE_MS);
		};
		schedule();
		const observer = new ResizeObserver(schedule);
		observer.observe(element);
		return () => {
			window.clearTimeout(timer);
			observer.disconnect();
		};
	}, [ref]);
	return rect;
}

function useWindowWidth(): number {
	const [width, setWidth] = useState(initialWindowWidth);
	useEffect(() => {
		const onResize = () => {
			setWidth(document.body.clientWidth);
		};
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("resize", onResize);
		};
	}, []);
	return width;
}

/** Upstream zoomedIds: ids zoomed into while mounted that are still on the trail, plus the current one. */
function useZoomedIds(trailIds: string[], currentId: string): string[] {
	const [zoomedIds, setZoomedIds] = useState<string[]>([currentId]);
	const onTrail = new Set(trailIds);
	const next = [...zoomedIds.filter((id) => id !== currentId && onTrail.has(id)), currentId];
	if (next.join("/") !== zoomedIds.join("/")) {
		setZoomedIds(next);
	}
	return next;
}

interface BreadcrumbsProps {
	nodeId: string | null;
}

/** Upstream's header breadcrumbs: flat crumbs from Home to the zoomed node, truncated and middle-collapsed to fit. */
export function Breadcrumbs({nodeId}: BreadcrumbsProps) {
	const {navigateToNode, cancelSearch} = useNodeNavigation();
	const searchActive = useOutlineStore((state) => state.searchQuery !== "");
	const {data: ancestors, isLoading} = useAncestors(nodeId);
	const containerRef = useRef<HTMLDivElement>(null);
	const [containerLeft, containerWidth] = useContainerRect(containerRef);
	const windowWidth = useWindowWidth();

	const crumbs: Crumb[] =
		nodeId === null || isLoading || ancestors === undefined
			? [ROOT_CRUMB]
			: [ROOT_CRUMB, ...ancestors.map((node) => ({id: node.id, isRoot: false, name: node.name}))];
	const currentId = crumbs.at(-1)?.id ?? ROOT_CRUMB.id;
	const inputs = crumbs.map((crumb) => ({id: crumb.id, label: crumb.isRoot ? HOME_LABEL : crumbLabel(crumb.name)}));

	const zoomedIds = useZoomedIds(
		crumbs.map((crumb) => crumb.id),
		currentId,
	);

	// Upstream memoizes on width and the joined id path, not on array identity.
	const inputsKey = inputs.map(({id, label}) => `${id}\u0000${label}`).join("/");
	const visible = useMemo(
		() => layout.calculateVisibleItems(inputs, containerWidth, zoomedIds),
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized trail; inputs and zoomedIds are rebuilt every render
		[containerWidth, inputsKey],
	);
	const chunks = layout.getItemGroupsWithLeftOffset(layout.getItemGroups(visible));
	const crumbsById = new Map(crumbs.map((crumb) => [crumb.id, crumb]));

	return (
		<div
			ref={containerRef}
			className="breadcrumbs grow shrink min-w-0 flex gap-m items-center text-s leading-base overflow-hidden"
		>
			{chunks.flatMap(({items, leftOffset}) => {
				if (items[0]?.group === 1) {
					return [
						<ButtonMenu
							key={`more-${leftOffset}-${currentId}`}
							actOnHover
							button={
								<IconButton size="md">
									<FaIcon icon="fal:ellipsis" />
								</IconButton>
							}
						>
							<BreadcrumbOverflowMenu
								items={items}
								crumbs={crumbsById}
								currentId={currentId}
								maxWidth={windowWidth - leftOffset - containerLeft - OVERFLOW_MENU_GUTTER}
								onNavigate={navigateToNode}
								searchActive={searchActive}
								onCancelSearch={cancelSearch}
							/>
						</ButtonMenu>,
						<BreadcrumbSeparator key={`breadcrumb-icon-${leftOffset}`} />,
					];
				}
				return items.flatMap((item) => {
					const crumb = crumbsById.get(item.id);
					if (crumb === undefined) {
						return [];
					}
					const current = item.id === currentId;
					const element = (
						<BreadcrumbItem
							key={crumb.id}
							crumb={crumb}
							current={current}
							truncateWidth={item.truncateWidth}
							onNavigate={navigateToNode}
							searchActive={searchActive}
							onCancelSearch={cancelSearch}
						/>
					);
					return current ? [element] : [element, <BreadcrumbSeparator key={`${crumb.id}-separator`} />];
				});
			})}
		</div>
	);
}
