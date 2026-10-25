import type {MirrorInstance} from "../../mirror-path.js";
import {bulletClickAction, nodeUrl} from "../navigation.js";

interface NodeBulletProps {
	nodeId: string;
	/** Where the row sits inside a mirror: its link is the virtual `v_…` location. */
	instance?: MirrorInstance | null;
	isMirror: boolean;
	showHalo: boolean;
	keepBullet: boolean;
	onMouseDown: (event: React.MouseEvent<HTMLAnchorElement>) => void;
	/** A plain press that did not become a drag; a selected row's bullet clears the selection instead. */
	onZoom: () => void;
	isInSelection: () => boolean;
	onClearSelection: () => void;
}

/**
 * The zoom bullet: upstream's `a.bullet > span.bulletHalo > svg`. A collapsed
 * parent shows the halo; a mirror renders a diamond. A press that does not
 * become a drag zooms in. A plain element, not a component, so a resting row mounts no fiber for it.
 */
export function nodeBullet({
	nodeId,
	instance = null,
	isMirror,
	showHalo,
	keepBullet,
	onMouseDown,
	onZoom,
	isInSelection,
	onClearSelection,
}: NodeBulletProps) {
	const className = ["bullet", isMirror && "diamond", showHalo && "bullet--show-halo", keepBullet && "keep-bullet"]
		.filter(Boolean)
		.join(" ");
	return (
		<a
			href={nodeUrl(nodeId, instance)}
			data-handbook="bullet.handle"
			data-item-id={nodeId}
			className={className}
			style={{left: "calc(var(--name-left-overhang) + 1px)", width: "18px", ["--bullet-size" as string]: "18px"}}
			onMouseDown={onMouseDown}
			onClick={(event) => {
				event.stopPropagation();
				// Only a press the drag armed and released before moving 3px acts; a finished drag does not.
				const armed = event.currentTarget.dataset.preDragClick === "true";
				delete event.currentTarget.dataset.preDragClick;
				const action = bulletClickAction({
					metaKey: event.metaKey,
					ctrlKey: event.ctrlKey,
					button: event.button,
					armed,
					inSelection: isInSelection(),
				});
				if (action === "browser") {
					return;
				}
				event.preventDefault();
				if (action === "clear-selection") {
					onClearSelection();
				} else if (action === "zoom") {
					onZoom();
				}
			}}
		>
			<span className="bulletHalo">
				{isMirror ? (
					<svg
						width="100%"
						height="100%"
						viewBox="0 0 16 16"
						fill="currentColor"
						className="mirrorDiamondIcon"
					>
						<path d="M8 4 L4 8 L8 12 L12 8 Z" />
					</svg>
				) : (
					<svg width="100%" height="100%" viewBox="0 0 18 18" fill="currentColor" className="zoomBulletIcon">
						<circle cx="9" cy="9" r="3.5" />
					</svg>
				)}
			</span>
		</a>
	);
}
