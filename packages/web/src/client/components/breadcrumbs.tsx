import type {MouseEvent} from "react";
import {crumbLabel as formatCrumbLabel} from "../crumb-label.js";
import {useAncestors} from "../hooks/use-nodes.js";
import {nodeRoute, useNodeNavigation} from "../navigation.js";
import {FaIcon} from "./fa-icons.js";
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
}

interface CrumbClickDeps {
	navigateToNode: (nodeId: string | null) => void;
}

/** Plain clicks navigate in-app; modified and middle clicks fall through to the anchor's href. */
// oxlint-disable-next-line react/only-export-components -- pure click handler exported for tests and reuse by other crumb renderers
export function handleCrumbClick(event: CrumbClickEvent, crumb: Crumb, {navigateToNode}: CrumbClickDeps): void {
	if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1) {
		return;
	}
	event.preventDefault();
	navigateToNode(crumb.isRoot ? null : crumb.id);
}

function BreadcrumbSeparator() {
	return (
		<svg width="5" height="8" viewBox="0 0 5 8" fill="none" className="flex-shrink-0">
			<path d="M0 0 L4 4 L0 8" stroke="currentColor" strokeLinecap="round" />
		</svg>
	);
}

function crumbLabel(name: string | null | undefined): string {
	const label = formatCrumbLabel(name ?? "", {now: new Date()});
	return label === "" ? "Untitled" : label;
}

interface CrumbProps {
	crumb: Crumb;
	current: boolean;
	truncateWidth?: number;
	onNavigate: (nodeId: string | null) => void;
}

/** One upstream `.breadcrumb-item`: an anchor when enabled, a div for the disabled Home at the root. */
function BreadcrumbItem({crumb, current, truncateWidth, onNavigate}: CrumbProps) {
	const disabled = crumb.isRoot && current;
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
	const style = {maxWidth: truncateWidth};

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
			href={crumb.isRoot ? "/" : nodeRoute(crumb.id)}
			data-item-id={crumb.isRoot ? "None" : crumb.id}
			onClick={(event: MouseEvent<HTMLAnchorElement>) => {
				handleCrumbClick(event, crumb, {navigateToNode: onNavigate});
			}}
		>
			{content}
		</a>
	);
}

interface BreadcrumbsProps {
	nodeId: string | null;
}

/** Upstream's header breadcrumbs: flat crumbs from Home to the zoomed node, a chevron after each non-current one. */
export function Breadcrumbs({nodeId}: BreadcrumbsProps) {
	const {navigateToNode} = useNodeNavigation();
	const {data: ancestors, isLoading} = useAncestors(nodeId);

	const crumbs: Crumb[] =
		nodeId === null || isLoading || ancestors === undefined
			? [ROOT_CRUMB]
			: [ROOT_CRUMB, ...ancestors.map((node) => ({id: node.id, isRoot: false, name: node.name}))];

	return (
		<div className="breadcrumbs grow shrink min-w-0 flex gap-m items-center text-s leading-base overflow-hidden">
			{crumbs.flatMap((crumb, index) => {
				const current = index === crumbs.length - 1;
				const item = (
					<BreadcrumbItem key={crumb.id} crumb={crumb} current={current} onNavigate={navigateToNode} />
				);
				return current ? [item] : [item, <BreadcrumbSeparator key={`${crumb.id}-separator`} />];
			})}
		</div>
	);
}
