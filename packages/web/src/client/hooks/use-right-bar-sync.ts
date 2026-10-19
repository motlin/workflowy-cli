import {useQuery} from "@tanstack/react-query";
import {useEffect} from "react";
import {useOutlineStore} from "../stores/outline.js";
import {fetchPreferences, preferenceKeys, serverShowKeyboardShortcuts} from "./use-preferences.js";

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
