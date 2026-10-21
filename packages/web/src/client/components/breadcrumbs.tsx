import {useMemo, useRef, useState} from "react";
import type {MouseEvent} from "react";
import {createBreadcrumbLayout, measureCrumbLabel} from "../breadcrumb-layout.js";
import type {LayoutCrumb} from "../breadcrumb-layout.js";
import {crumbLabel as formatCrumbLabel} from "../crumb-label.js";
import {useContainerRect, useWindowWidth} from "../hooks/use-container-rect.js";
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
	/** Leave the search without its own URL push, since the crumb navigation drops `?q=`. */
	leaveSearch: () => void;
	scrollToTop: () => void;
	focusWindow: () => void;
}

/**
 * Plain clicks focus the window, exit any committed search, navigate in-app and scroll to the top, pushing one history
 * entry so a single Back returns to the search; modified and middle clicks fall through to the anchor's href. The root
 * Home is only clickable during a search, which it exits.
 */
// oxlint-disable-next-line react/only-export-components -- pure click handler exported for tests and reuse by other crumb renderers
export function handleCrumbClick(
	event: CrumbClickEvent,
	crumb: Crumb,
	{current, searchActive}: CrumbClickState,
	{navigateToNode, cancelSearch, leaveSearch, scrollToTop, focusWindow}: CrumbClickDeps,
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
	if (!rootDuringSearch) {
		if (searchActive) {
			leaveSearch();
		}
		navigateToNode(crumb.isRoot ? null : crumb.id);
	} else if (searchActive) {
		cancelSearch();
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

/** The outline scrolls the window, like upstream. */
function scrollOutlineToTop(): void {
	window.scrollTo(0, 0);
}

function noop(): void {}

/** `dayPrefix` is the 📆 Calendar root's Friendly day names setting, which upstream's crumb decorator honors too. */
function crumbLabel(name: string | null | undefined, dayPrefix = true): string {
	const label = formatCrumbLabel(name ?? "", {now: new Date(), dayPrefix});
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
	/** Prefix a day within one day of today with Yesterday/Today/Tomorrow. */
	dayPrefix?: boolean;
}

/** One upstream `.breadcrumb-item`: an anchor when enabled, a div for the disabled Home at the root. */
export function BreadcrumbItem({
	crumb,
	current,
	truncateWidth,
	onNavigate,
	searchActive = false,
	onCancelSearch = noop,
	dayPrefix = true,
}: CrumbProps) {
	const leaveSearch = useOutlineStore((state) => state.leaveSearch);
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
		crumbLabel(crumb.name, dayPrefix)
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
						leaveSearch,
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
	dayPrefix?: boolean;
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
	dayPrefix,
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
							dayPrefix={dayPrefix}
						/>
					</div>
				);
			})}
		</div>
	);
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
	const dayPrefix = ancestors?.find((node) => node.calendar?.root === true)?.calendar?.dayPrefix !== false;
	const inputs = crumbs.map((crumb) => ({
		id: crumb.id,
		label: crumb.isRoot ? HOME_LABEL : crumbLabel(crumb.name, dayPrefix),
	}));

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
								dayPrefix={dayPrefix}
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
							dayPrefix={dayPrefix}
						/>
					);
					return current ? [element] : [element, <BreadcrumbSeparator key={`${crumb.id}-separator`} />];
				});
			})}
		</div>
	);
}

// Upstream's Found Dates crumbs pass `sizes: {minItemWidth: 80}` and `threeDotPosition: "left"`.
const leftCollapseLayout = createBreadcrumbLayout({minItemWidth: 80, threeDotPosition: "left"}, (label) =>
	measureCrumbLabel(label),
);

/**
 * Upstream GuiCrumbs.Widget with hideCurrent and threeDotPosition "left": the ancestors of an item, the widest
 * truncated and the leftmost collapsed into an ellipsis menu to fit the row, with no separator after the last.
 */
export function LeftCollapsingCrumbs({crumbs}: {crumbs: Crumb[]}) {
	const {navigateToNode} = useNodeNavigation();
	const containerRef = useRef<HTMLDivElement>(null);
	const [containerLeft, containerWidth] = useContainerRect(containerRef);
	const windowWidth = useWindowWidth();
	const inputs = crumbs.map((crumb) => ({id: crumb.id, label: crumb.isRoot ? HOME_LABEL : crumbLabel(crumb.name)}));
	const inputsKey = inputs.map(({id, label}) => `${id}\u0000${label}`).join("/");
	const visible = useMemo(
		() => leftCollapseLayout.calculateVisibleItems(inputs, containerWidth, []),
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized trail; inputs is rebuilt every render
		[containerWidth, inputsKey],
	);
	const chunks = leftCollapseLayout.getItemGroupsWithLeftOffset(leftCollapseLayout.getItemGroups(visible));
	const crumbsById = new Map(crumbs.map((crumb) => [crumb.id, crumb]));
	const elements = chunks.flatMap(({items, leftOffset}) => {
		if (items[0]?.group === 1) {
			return [
				<ButtonMenu
					key={`more-${leftOffset}`}
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
						currentId=""
						maxWidth={windowWidth - leftOffset - containerLeft - OVERFLOW_MENU_GUTTER}
						onNavigate={navigateToNode}
					/>
				</ButtonMenu>,
			];
		}
		return items.flatMap((item) => {
			const crumb = crumbsById.get(item.id);
			return crumb === undefined
				? []
				: [
						<BreadcrumbItem
							key={crumb.id}
							crumb={crumb}
							current={false}
							truncateWidth={item.truncateWidth}
							onNavigate={navigateToNode}
						/>,
					];
		});
	});
	return (
		<div
			ref={containerRef}
			className="breadcrumbs grow shrink min-w-0 flex gap-m items-center text-s leading-base overflow-hidden"
		>
			{elements.flatMap((element, index) =>
				index === 0 ? [element] : [<BreadcrumbSeparator key={`separator-${element.key}`} />, element],
			)}
		</div>
	);
}
