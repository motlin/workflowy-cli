import {useEffect, useRef} from "react";
import {useLocation} from "react-router-dom";
import {z} from "zod";
import {derive, useNavHistoryStore} from "../nav-history.js";

// React Router stores the history stack position in `history.state.idx`.
const HistoryStateSchema = z.object({idx: z.number()});

/**
 * Feed location changes into the app-level navigation stack and report whether
 * Back and Forward are possible. Mount once (the top bar owns it).
 */
export function useNavigationHistory(): {canGoBack: boolean; canGoForward: boolean} {
	const location = useLocation();
	const dispatch = useNavHistoryStore((state) => state.dispatch);
	const canGoBack = useNavHistoryStore((state) => derive(state).canGoBack);
	const canGoForward = useNavHistoryStore((state) => derive(state).canGoForward);
	const isPopStateRef = useRef(false);

	useEffect(() => {
		function handlePopState() {
			isPopStateRef.current = true;
		}

		globalThis.addEventListener("popstate", handlePopState);
		return () => {
			globalThis.removeEventListener("popstate", handlePopState);
		};
	}, []);

	useEffect(() => {
		const path = location.pathname + location.search;
		if (isPopStateRef.current) {
			isPopStateRef.current = false;
			const state = HistoryStateSchema.safeParse(history.state);
			dispatch({type: "pop", path, idx: state.success ? state.data.idx : undefined});
		} else {
			dispatch({type: "push", path});
		}
	}, [location, dispatch]);

	return {canGoBack, canGoForward};
}
