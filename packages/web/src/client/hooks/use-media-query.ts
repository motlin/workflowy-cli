import {useCallback, useSyncExternalStore} from "react";

/** Live `matchMedia(query).matches`; true during server rendering. */
export function useMediaQuery(query: string): boolean {
	const subscribe = useCallback(
		(onChange: () => void) => {
			const list = globalThis.matchMedia(query);
			list.addEventListener("change", onChange);
			return () => {
				list.removeEventListener("change", onChange);
			};
		},
		[query],
	);
	return useSyncExternalStore(
		subscribe,
		() => globalThis.matchMedia(query).matches,
		() => true,
	);
}
