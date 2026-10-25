import {useState} from "react";
import type {ReactElement, ReactNode} from "react";
import {openMenuExport} from "../export-entry.js";
import {useSaving} from "../hooks/use-saving.js";
import {readJson} from "../read-json.js";
import {activeZoomedId, useOutlineStore} from "../stores/outline.js";
import {autosaveText} from "../time-ago.js";
import {useUndoStore} from "../undo-history.js";
import {FaIcon} from "./fa-icons.js";
import {MenuItem, MenuSeparator} from "./flyout/menu-item.js";
import {LoadingSpinner} from "./loading-spinner.js";
import {
	buildMenuRows,
	entryFromItem,
	HELP_SUBMENU_GROUPS,
	MAIN_MENU_GROUPS,
	helpEntries,
	mainMenuEntries,
} from "./main-menu-model.js";
import type {GearMenuHeaderItem, MainMenuEntry} from "./main-menu-model.js";

const NO_HEADER_ITEMS: GearMenuHeaderItem[] = [];

export interface MainMenuRowsOptions {
	/** Compacted header actions (under 701px), prepended with a separator. */
	headerItems?: GearMenuHeaderItem[];
	/** Upstream's `header.move-pane-left` / `header.move-pane-right` rows; empty with no pane open. */
	paneItems?: GearMenuHeaderItem[];
	onOpenSettings: () => void;
	onExpandAll: () => void;
	onCollapseAll: () => void;
	onUndo: () => void;
	onRedo: () => void;
	/** Opens the Help submenu. */
	onOpenHelp?: () => void;
}

/** Upstream's `status.autosave` footer (KY): the only save-state UI, so writes never block the outline. */
function AutosaveStatus() {
	const saving = useSaving();
	const lastSavedAt = useOutlineStore((state) => state.lastSavedAt);
	// The footer mounts with the open menu, so its age is measured from when the menu opened.
	const [openedAt] = useState(() => Date.now());
	return (
		<div className="flex items-center justify-center text-center leading-none text-tertiary text-xs py-xs">
			{saving && <LoadingSpinner size="small" />}
			{autosaveText({saving, lastSavedAt, now: Math.max(openedAt, lastSavedAt)})}
		</div>
	);
}

function openUrl(url: string): void {
	window.open(url, "_blank", "noopener");
}

function entryNode(key: string, entry: MainMenuEntry): ReactElement {
	if ("component" in entry) {
		return <AutosaveStatus key={key} />;
	}
	return (
		<MenuItem
			disabled={entry.disabled}
			extra={entry.extra === undefined ? undefined : <FaIcon icon={`fal:${entry.extra}`} />}
			handbook={entry.handbook}
			icon={entry.icon}
			key={key}
			label={entry.label}
			onSelect={entry.onSelect}
			shortcut={entry.shortcut}
			subtext={entry.subtext}
		/>
	);
}

function rowNodes(rows: ReturnType<typeof buildMenuRows>): ReactNode[] {
	return rows.map((row) =>
		"separator" in row ? <MenuSeparator key={`separator-before-${row.before}`} /> : entryNode(row.key, row.entry),
	);
}

/** The Help submenu's rows (no icons). Learn WorkFlowy, Community and Blog open upstream's pages. */
export function useHelpMenuRows(): ReactNode[] {
	return rowNodes(buildMenuRows(HELP_SUBMENU_GROUPS, helpEntries({hasHelpDialog: false, openUrl})));
}

/**
 * The main menu's rows, for a ButtonMenu's children (MenuBody reads its direct MenuItem children, so these are
 * a flat list, not a component). What's New and Connect Apps with Zapier are deliberately omitted: there is no
 * changelog or Zapier backend locally. Every `onSelect` returns undefined, so selecting a row closes the menu.
 */
export function useMainMenuRows({
	headerItems = NO_HEADER_ITEMS,
	paneItems = NO_HEADER_ITEMS,
	onOpenSettings,
	onExpandAll,
	onCollapseAll,
	onUndo,
	onRedo,
	onOpenHelp = () => {},
}: MainMenuRowsOptions): ReactNode[] {
	const openExportDialog = useOutlineStore((state) => state.openExportDialog);
	const canUndo = useUndoStore((state) => state.canUndo);
	const canRedo = useUndoStore((state) => state.canRedo);

	const entries = mainMenuEntries({
		canUndo,
		canRedo,
		paneRows: paneItems,
		actions: {
			undo: onUndo,
			redo: onRedo,
			expandAll: onExpandAll,
			collapseAll: onCollapseAll,
			exportZoomed: () => {
				void openMenuExport(
					activeZoomedId(useOutlineStore.getState()),
					async () => {
						const response = await fetch("/api/v1/nodes");
						return response.ok
							? (await readJson<{nodes: {id: string}[]}>(response)).nodes.map((node) => node.id)
							: [];
					},
					openExportDialog,
				);
			},
			print: () => {
				globalThis.print();
			},
			openSettings: onOpenSettings,
			openUrl,
			openHelp: onOpenHelp,
		},
	});
	const compactKeys: string[] = [];
	headerItems.forEach((item, index) => {
		const key = `header.compact.${index}`;
		entries[key] = entryFromItem(item);
		compactKeys.push(key);
	});
	const groups = compactKeys.length > 0 ? [...compactKeys, "------------", ...MAIN_MENU_GROUPS] : MAIN_MENU_GROUPS;
	return rowNodes(buildMenuRows(groups, entries));
}
