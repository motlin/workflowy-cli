import type {ReactNode} from "react";
import {locationKey} from "@workflowy/shared";
import {useChildren, useHome, useNode} from "../hooks/use-nodes.js";
import {useShowCompletedToggle} from "../hooks/use-show-completed-toggle.js";
import {useStarActions, useStars} from "../hooks/use-starred.js";
import {internalLinkUrl} from "../item-menu-model.js";
import {currentTypeIcon} from "../layout-types.js";
import {useOutlineStore} from "../stores/outline.js";
import {FaIcon} from "./fa-icons.js";
import type {GearMenuHeaderItem} from "./gear-menu.js";
import {typeIcon} from "./item-type-icon.js";
import {StarIcon} from "./star-button.js";

/** A header's compactable actions (upstream's share, present, star, show-completed and layout) for one pane's zoom. */
export interface HeaderActions {
	canPresent: boolean;
	isStarred: boolean;
	showCompleted: boolean;
	layoutIcon: ReactNode;
	share: () => void;
	present: () => void;
	toggleStar: () => void;
	toggleCompleted: () => void;
	/** Upstream: showItemTypePicker at {top: rect.bottom + 4, left: rect.left}; the picker centers itself there. */
	openLayoutPicker: (anchor: Element | null) => void;
}

/** The compactable header actions acting on `zoomedId` (null is Home). */
export function useHeaderActions(zoomedId: string | null): HeaderActions {
	const showCompleted = useOutlineStore((state) => state.showCompleted);
	const openPresentation = useOutlineStore((state) => state.openPresentation);
	const showItemTypePicker = useOutlineStore((state) => state.showItemTypePicker);
	const toggleCompleted = useShowCompletedToggle();
	const {stars, unavailable: starsUnavailable} = useStars();
	const {toggleStar} = useStarActions();
	const pageKey = zoomedId === null ? null : locationKey({nodeId: zoomedId, query: null});
	const zoomedNode = useNode(zoomedId);
	const home = useHome();
	const rootChildren = useChildren(null);
	return {
		canPresent: zoomedId === null ? (rootChildren.data?.length ?? 0) > 0 : zoomedNode.data?.hasChildren === true,
		isStarred: stars.some((star) => star.key === pageKey),
		showCompleted,
		layoutIcon: (
			<FaIcon
				icon={typeIcon(
					currentTypeIcon(zoomedId === null ? home.data?.layoutMode : zoomedNode.data?.data.layoutMode),
				)}
			/>
		),
		share: () => {
			if (zoomedId !== null) {
				window.open(internalLinkUrl(zoomedId), "_blank", "noopener");
			}
		},
		present: () => {
			openPresentation(zoomedId ?? "root");
		},
		toggleStar: () => {
			if (zoomedId !== null && !starsUnavailable) {
				void toggleStar({nodeId: zoomedId, query: null});
			}
		},
		toggleCompleted,
		openLayoutPicker: (anchor) => {
			if (anchor) {
				const rect = anchor.getBoundingClientRect();
				showItemTypePicker({nodeIds: [zoomedId ?? "home"], position: {top: rect.bottom + 4, left: rect.left}});
			}
		},
	};
}

/**
 * The compactable actions as more-menu rows, like upstream's `more-menu.menu.header.*`. Change layout has no element
 * of its own, so its picker opens under the kebab that `anchorSelector` finds, like upstream.
 */
export function compactHeaderItems(
	actions: HeaderActions,
	zoomedId: string | null,
	anchorSelector: string,
): GearMenuHeaderItem[] {
	const items: GearMenuHeaderItem[] = [];
	if (zoomedId !== null) {
		items.push({label: "Share", icon: <FaIcon icon="fal:user-plus" />, onSelect: actions.share});
	}
	items.push({
		label: "Present",
		icon: <FaIcon icon="fal:play" />,
		onSelect: actions.present,
		disabled: !actions.canPresent,
	});
	if (zoomedId !== null) {
		items.push({
			label: actions.isStarred ? "Unstar" : "Star",
			icon: <StarIcon starred={actions.isStarred} />,
			onSelect: actions.toggleStar,
		});
	}
	items.push(
		{
			label: actions.showCompleted ? "Hide completed" : "Show completed",
			icon: <FaIcon icon="fal:check" />,
			onSelect: actions.toggleCompleted,
		},
		{
			label: "Change layout",
			icon: actions.layoutIcon,
			onSelect: () => {
				actions.openLayoutPicker(document.querySelector(anchorSelector));
			},
		},
	);
	return items;
}
