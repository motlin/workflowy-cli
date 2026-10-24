import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import type {ReactNode} from "react";
import {MenuBody} from "../../src/client/components/flyout/menu.js";
import type {GearMenuHeaderItem, GearMenuRowsOptions} from "../../src/client/components/gear-menu.js";

type UseGearMenuRows = (options: GearMenuRowsOptions) => ReactNode[];

/** Renders the main menu's rows inside MenuBody (the ButtonMenu's body), as a flyout would. */
export function renderGearMenuRows(
	useGearMenuRows: UseGearMenuRows,
	headerItems: GearMenuHeaderItem[] = [],
	paneItems: GearMenuHeaderItem[] = [],
): string {
	function Rows() {
		const rows = useGearMenuRows({
			headerItems,
			paneItems,
			onOpenSettings: () => {},
			onExpandAll: () => {},
			onCollapseAll: () => {},
			onUndo: () => {},
			onRedo: () => {},
		});
		return createElement(MenuBody, {unwrapped: true}, ...rows);
	}
	return renderToStaticMarkup(createElement(Rows));
}
