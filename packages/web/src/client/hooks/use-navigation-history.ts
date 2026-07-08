import {useEffect, useRef, useState} from 'react';
import {useLocation} from 'react-router-dom';

/**
 * Track whether forward navigation is possible.
 *
 * The browser History API doesn't expose forward history availability directly.
 * We track this by maintaining our own navigation stack:
 * 1. When navigating to a new page, push to stack and clear forward entries
 * 2. When going back (popstate), mark that forward is now available
 * 3. When going forward (popstate), check if we're at the end
 */
export function useNavigationHistory() {
	const [canGoForward, setCanGoForward] = useState(false);
	const location = useLocation();

	// Track history stack position
	const historyStackRef = useRef<string[]>([]);
	const currentIndexRef = useRef(-1);
	const isPopStateRef = useRef(false);

	useEffect(() => {
		function handlePopState() {
			isPopStateRef.current = true;
		}

		globalThis.addEventListener('popstate', handlePopState);
		return () => globalThis.removeEventListener('popstate', handlePopState);
	}, []);

	useEffect(() => {
		const currentPath = location.pathname + location.search;

		if (isPopStateRef.current) {
			// This is a back/forward navigation
			isPopStateRef.current = false;

			const previousIndex = currentIndexRef.current;
			const pathIndex = historyStackRef.current.lastIndexOf(currentPath);

			if (pathIndex !== -1 && pathIndex < previousIndex) {
				// User went back
				currentIndexRef.current = pathIndex;
				setCanGoForward(true);
			} else if (pathIndex !== -1 && pathIndex > previousIndex) {
				// User went forward
				currentIndexRef.current = pathIndex;
				// Check if there's still more forward history
				setCanGoForward(pathIndex < historyStackRef.current.length - 1);
			} else {
				// Path not found in stack, or same position
				// Try to determine direction from history.state if available
				const {state} = history;
				if (state?.idx !== undefined) {
					const newIndex = state.idx;
					if (newIndex < previousIndex) {
						setCanGoForward(true);
					} else if (newIndex >= historyStackRef.current.length - 1) {
						setCanGoForward(false);
					}
					currentIndexRef.current = newIndex;
				}
			}
		} else {
			// This is a new navigation (link click, programmatic navigate)
			// Truncate forward history and add new entry
			const stack = historyStackRef.current;
			const newIndex = currentIndexRef.current + 1;

			// Remove any forward entries
			stack.length = newIndex;
			// Add new entry
			stack.push(currentPath);
			currentIndexRef.current = newIndex;

			// New navigation clears forward history
			setCanGoForward(false);
		}
	}, [location]);

	return {canGoForward};
}
