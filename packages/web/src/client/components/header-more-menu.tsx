import {useRef, useState} from "react";
import {useExpandAll} from "../hooks/use-nodes.js";
import {useOutlineStore} from "../stores/outline.js";
import {FaIcon} from "./fa-icons.js";
import {GearMenu} from "./gear-menu.js";
import {compactHeaderItems, useHeaderActions} from "./header-actions.js";
import {IconButton} from "./icon-button.js";

interface HeaderMoreMenuProps {
	/** The zoom the menu's actions act on (null is Home). */
	zoomedId: string | null;
	/** Upstream's compact header: the compactable actions move into this menu. */
	compact: boolean;
	/** Finds this kebab in the DOM, to anchor Change layout's picker under it. */
	anchorSelector: string;
	onUndo: () => void;
	onRedo: () => void;
}

/**
 * The header kebab (upstream's gearMenu wrapper, no tooltip; blue dot omitted with no unread rows locally). Its
 * Expand/Collapse all act on the zoomed item's whole subtree (every top-level item at Home).
 */
export function HeaderMoreMenu({zoomedId, compact, anchorSelector, onUndo, onRedo}: HeaderMoreMenuProps) {
	const [open, setOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);
	const openSettings = useOutlineStore((state) => state.openSettings);
	const expandAll = useExpandAll();
	const actions = useHeaderActions(zoomedId);
	const close = () => {
		setOpen(false);
	};
	return (
		<div
			// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's focusable gearMenu wrapper; markup parity with workflowy.com
			tabIndex={0}
			className="relative outline-none menu gearMenu"
			ref={menuRef}
		>
			<div>
				<IconButton
					onClick={() => {
						setOpen((previous) => !previous);
					}}
				>
					<FaIcon icon="fal:ellipsis-vertical" size="lg" />
				</IconButton>
			</div>
			<GearMenu
				headerItems={compact ? compactHeaderItems(actions, zoomedId, anchorSelector) : []}
				isOpen={open}
				onClose={close}
				onCollapseAll={() => {
					expandAll(zoomedId, false);
				}}
				onExpandAll={() => {
					expandAll(zoomedId, true);
				}}
				onOpenSettings={() => {
					setOpen(false);
					openSettings();
				}}
				onRedo={onRedo}
				onUndo={onUndo}
			/>
		</div>
	);
}
