/**
 * Applies the account's Custom tree (upstream's `custom-tree` module): Hotkeys nodes become keymap overrides and
 * Themes nodes become themes with adopted stylesheets. The tree is read from `/api/v1/custom-tree` and re-read after
 * every successful mutation, standing in for upstream's `operation.applied` re-apply.
 */

import {useQuery, useQueryClient} from "@tanstack/react-query";
import {useEffect} from "react";
import {readJson} from "../read-json.js";
import {applyThemeSheets, parseCustomThemes} from "../custom-themes.js";
import {parseCustomHotkeys} from "../keys/custom-hotkeys.js";
import type {CustomNode} from "../keys/custom-hotkeys.js";
import {HOTKEYS} from "../keys/keymap.js";
import {useCustomKeymapStore} from "../stores/custom-keymap.js";
import {useCustomThemesStore} from "../stores/custom-themes.js";

export const CUSTOM_ROOT_STORAGE_KEY = "wf-custom-root-id";

export interface CustomTreeResponse {
	rootId: string | null;
	rootChildren: {id: string; name: string}[];
	sections: Record<string, CustomNode[]>;
}

/** The root id the user chose in this browser, if any. */
export function chosenCustomRootId(): string | undefined {
	try {
		return localStorage.getItem(CUSTOM_ROOT_STORAGE_KEY) ?? undefined;
	} catch {
		return undefined;
	}
}

export async function fetchCustomTree(rootId: string | undefined): Promise<CustomTreeResponse> {
	const query = rootId === undefined ? "" : `?rootId=${encodeURIComponent(rootId)}`;
	const response = await fetch(`/api/v1/custom-tree${query}`);
	if (!response.ok) {
		throw new Error("Failed to fetch the custom tree");
	}
	return readJson<CustomTreeResponse>(response);
}

/** Applies one read of the tree; a missing root turns every customization off. */
export function applyCustomTree(data: CustomTreeResponse): void {
	useCustomKeymapStore.getState().set(parseCustomHotkeys(data.sections.Hotkeys ?? [], HOTKEYS));
	const {themes, css} = parseCustomThemes(data.sections.Themes ?? []);
	useCustomThemesStore.getState().set(Object.values(themes));
	applyThemeSheets(css);
}

export function useCustomTree(): void {
	const queryClient = useQueryClient();
	const {data} = useQuery({
		queryKey: ["custom-tree", chosenCustomRootId() ?? null],
		queryFn: async () => fetchCustomTree(chosenCustomRootId()),
	});
	useEffect(() => {
		if (data !== undefined) {
			applyCustomTree(data);
		}
	}, [data]);
	useEffect(
		() =>
			queryClient.getMutationCache().subscribe((event) => {
				if (event.type === "updated" && event.action.type === "success") {
					void queryClient.invalidateQueries({queryKey: ["custom-tree"]});
				}
			}),
		[queryClient],
	);
}
