import {Component, type ReactNode} from 'react';

interface ErrorBoundaryProps {
	children: ReactNode;
	fallback?: ReactNode;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
}

/**
 * Error boundary component that catches JavaScript errors anywhere in the child
 * component tree, logs them, and displays a fallback UI.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = {hasError: false, error: null};
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return {hasError: true, error};
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
		console.error('ErrorBoundary caught an error:', error, errorInfo);
	}

	handleRetry = (): void => {
		this.setState({hasError: false, error: null});
	};

	render(): ReactNode {
		const {hasError, error} = this.state;
		const {children, fallback} = this.props;

		if (hasError) {
			if (fallback) {
				return fallback;
			}

			return (
				<div className="error-boundary">
					<div className="error-boundary-content">
						<h2 className="error-boundary-title">Something went wrong</h2>
						<p className="error-boundary-message">{error?.message ?? 'An unexpected error occurred'}</p>
						<button
							className="error-boundary-retry"
							onClick={this.handleRetry}
							type="button"
						>
							Try again
						</button>
					</div>
				</div>
			);
		}

		return children;
	}
}
