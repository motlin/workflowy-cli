import {useMemo} from "react";
import {useOutlineStore} from "../stores/outline.js";
import {FaIcon} from "./fa-icons.js";
import {IconButton} from "./icon-button.js";
import {OutlineTree} from "./outline-tree.js";
import {PaneContext} from "./pane-context.js";

/**
 * Upstream's secondary item-tree pane (`[data-pane-id][data-pane-type=item-tree]`), opened by the top bar's
 * New pane button. It zooms independently of the main outline: its bullets zoom the pane, not the URL.
 * First slice: one pane, Home and Close pane in its header, no breadcrumbs, persistence or resizing yet.
 */
export function SidePane() {
	const sidePane = useOutlineStore((state) => state.sidePane);
	const zoomSidePane = useOutlineStore((state) => state.zoomSidePane);
	const closeSidePane = useOutlineStore((state) => state.closeSidePane);
	const pane = useMemo(() => ({zoom: zoomSidePane}), [zoomSidePane]);
	if (sidePane === null) {
		return null;
	}
	return (
		<div
			data-pane-id="side"
			data-pane-type="item-tree"
			data-pane-active="true"
			className="side-pane group/pane relative box-border flex-none bg-primary flex flex-col"
		>
			<div className="wf-header header bg-primary wf-pane-header border-b border-solid border-primary flex-shrink-0">
				<IconButton
					data-handbook="nav.home"
					onClick={() => {
						zoomSidePane(null);
					}}
					tooltip="Home"
				>
					<FaIcon icon="fal:house" />
				</IconButton>
				<div className="ml-auto flex self-stretch items-center gap-xs flex-shrink-0">
					<IconButton
						className="text-tertiary hover:text-on-surface flex-shrink-0"
						onClick={closeSidePane}
						tooltip="Close pane"
					>
						<FaIcon icon="fal:xmark" />
					</IconButton>
				</div>
			</div>
			<div className="side-pane-scroller vertical-scrollable-container">
				<PaneContext.Provider value={pane}>
					<OutlineTree parentId={sidePane.zoomedId} />
				</PaneContext.Provider>
			</div>
		</div>
	);
}
