import {useOutlineStore} from '../stores/outline.js';

/**
 * Displays a banner when the user is offline.
 * Appears at the top of the screen to indicate connection issues.
 */
export function OfflineBanner() {
	const isOnline = useOutlineStore((state) => state.isOnline);

	if (isOnline) {
		return null;
	}

	return (
		<div className="offline-banner">
			<span className="offline-banner-icon">!</span>
			<span className="offline-banner-message">
				You are currently offline. Changes will be saved when you reconnect.
			</span>
		</div>
	);
}
