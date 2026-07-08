function LoadingSpinner({size = 'medium'}: {size?: 'small' | 'medium' | 'large'}) {
	return (
		<div className={`loading-spinner loading-spinner-${size}`}>
			<div className="loading-spinner-circle" />
		</div>
	);
}

export function LoadingOverlay({message}: {message?: string}) {
	return (
		<div className="loading-overlay">
			<div className="loading-overlay-content">
				<LoadingSpinner size="large" />
				{message && <p className="loading-overlay-message">{message}</p>}
			</div>
		</div>
	);
}
