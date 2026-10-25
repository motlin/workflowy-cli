import {useQuery} from "@tanstack/react-query";
import {useEffect} from "react";
import {useOutlineStore} from "../stores/outline.js";
import type {Theme} from "../stores/outline.js";
import {fetchPreferences, preferenceKeys, serverShowKeyboardShortcuts, serverTheme} from "./use-preferences.js";

/** Adopt the account's `showKeyboardShortcuts` whenever `/api/v1/preferences` reports a value. */
export function useShowKeyboardShortcutsSync(): void {
	const {data} = useQuery({queryKey: preferenceKeys.all, queryFn: fetchPreferences});
	const showKeyboardShortcuts = serverShowKeyboardShortcuts(data);
	useEffect(() => {
		if (showKeyboardShortcuts !== null) {
			useOutlineStore.getState().adoptShowKeyboardShortcuts(showKeyboardShortcuts);
		}
	}, [showKeyboardShortcuts]);
}

/** The store theme for an account theme codename, or null for a theme the app does not have (upstream's other themes). */
export function themeFromAccount(name: string | null): Theme | null {
	if (name === "default") {
		return "light";
	}
	return name === "dark" || name === "system" ? name : null;
}

/** Adopt the account's `theme` over this browser's saved one whenever `/api/v1/preferences` reports a known value. */
export function useThemeSync(): void {
	const {data} = useQuery({queryKey: preferenceKeys.all, queryFn: fetchPreferences});
	const theme = themeFromAccount(serverTheme(data));
	useEffect(() => {
		if (theme !== null && useOutlineStore.getState().theme !== theme) {
			useOutlineStore.getState().setTheme(theme);
		}
	}, [theme]);
}
