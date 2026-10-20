import type {MouseEventHandler, ReactNode} from "react";
import {LoadingSpinner} from "./loading-spinner.js";

interface ButtonProps {
	variant: "primary" | "secondary";
	loading?: boolean;
	onClick?: MouseEventHandler<HTMLButtonElement>;
	children: ReactNode;
}

/**
 * Upstream `WF.Button.Primary` / `.Secondary` (desktop): a `button.button` with the variant class, its label in a
 * span that turns invisible while loading, when a spinner covers it and the button is disabled.
 */
export function Button({variant, loading = false, onClick, children}: ButtonProps) {
	return (
		<button
			// oxlint-disable-next-line react/button-has-type -- upstream renders the button without a type
			tabIndex={0}
			className={`${loading ? " " : " hover:no-underline"} button${loading ? " loading" : ""} ${variant}`}
			disabled={loading}
			onClick={onClick}
		>
			<span className={loading ? "invisible" : ""}>{children}</span>
			{loading ? (
				<span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
					<LoadingSpinner size="small" />
				</span>
			) : null}
		</button>
	);
}
