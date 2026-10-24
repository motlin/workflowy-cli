import {useNavigate} from "react-router-dom";
import {useExpandAll} from "../hooks/use-nodes.js";
import {movePane} from "../navigation.js";
import {useOutlineStore} from "../stores/outline.js";
import {FaIcon} from "./fa-icons.js";
import {ButtonMenu} from "./flyout/button-menu.js";
import {useGearMenuRows} from "./gear-menu.js";
import {compactHeaderItems, useHeaderActions} from "./header-actions.js";
import {IconButton} from "./icon-button.js";
import {movePaneItems} from "./move-pane-items.js";

interface HeaderMoreMenuProps {
	/** The zoom the menu's actions act on (null is Home). */
	zoomedId: string | null;
	/** The pane this kebab sits in (`main` for the main pane); its Move pane left/right rows move it. */
	paneId: string;
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
export function HeaderMoreMenu({zoomedId, paneId, compact, anchorSelector, onUndo, onRedo}: HeaderMoreMenuProps) {
	const navigate = useNavigate();
	const panes = useOutlineStore((state) => state.panes);
	const openSettings = useOutlineStore((state) => state.openSettings);
	const expandAll = useExpandAll();
	const actions = useHeaderActions(zoomedId);
	const rows = useGearMenuRows({
		headerItems: compact ? compactHeaderItems(actions, zoomedId, anchorSelector) : [],
		paneItems: movePaneItems({panes}, paneId, (id, index) => {
			movePane(navigate, id, index);
		}),
		onCollapseAll: () => {
			expandAll(zoomedId, false);
		},
		onExpandAll: () => {
			expandAll(zoomedId, true);
		},
		onOpenSettings: openSettings,
		onRedo,
		onUndo,
	});
	return (
		<ButtonMenu
			button={
				<IconButton>
					<FaIcon icon="fal:ellipsis-vertical" size="lg" />
				</IconButton>
			}
			className="gearMenu"
			maxHeight={700}
			minWidth={100}
			offset={[-8, 0]}
		>
			{rows}
		</ButtonMenu>
	);
}
