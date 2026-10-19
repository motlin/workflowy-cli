import {useOutlineStore} from "../stores/outline.js";
import type {AppMessageAction} from "../stores/outline.js";
import {FaIcon} from "./fa-icons.js";

const NO_ACTIONS: readonly AppMessageAction[] = [];

interface AppMessageProps {
	text: string;
	actions?: readonly AppMessageAction[];
	onClose?: () => void;
}

/** Upstream's WF.AppMessages success toast, pinned above the bottom edge of the viewport. */
export function AppMessage({text, actions = NO_ACTIONS, onClose}: AppMessageProps) {
	return (
		<div
			className="flex justify-center fixed left-0 right-0 leading-xs"
			style={{zIndex: 500, bottom: "calc(72px + var(--safe-area-inset-bottom))"}}
		>
			<div className="flex flex-row max-w-[90vw] gap-ml px-m shadow-sm bg-primary border border-solid border-primary rounded-s">
				<div className="h-full flex items-center">
					<FaIcon icon="fas:circle-check" size="lg" className="text-success" />
				</div>
				<div className="flex-1 min-w-0 py-m truncate first-letter:capitalize text-secondary font-light">
					{text}
				</div>
				{actions.map((action) => (
					// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- verbatim upstream markup; the shortcut is the keyboard path
					<div
						key={action.label}
						className="flex items-center text-primary content-end font-medium desktop:hover:underline cursor-pointer"
						style={{height: "100%"}}
						onClick={(event) => {
							event.preventDefault();
							onClose?.();
							action.run();
						}}
					>
						<div className="flex items-baseline">
							<span className="">{action.label}</span>
							{action.shortcut && (
								<span className="mobile:hidden text-s text-tertiary font-normal ml-xs">
									({action.shortcut})
								</span>
							)}
						</div>
					</div>
				))}
				<div className="h-full flex items-center">
					{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- verbatim upstream markup */}
					<span onClick={onClose} className="p-s cursor-pointer text-tertiary">
						<FaIcon icon="fal:xmark" />
					</span>
				</div>
			</div>
		</div>
	);
}

/** Renders the store's current app message, if any. Mount once at the app root. */
export function AppMessages() {
	const appMessage = useOutlineStore((state) => state.appMessage);
	const hideAppMessage = useOutlineStore((state) => state.hideAppMessage);
	if (!appMessage) {
		return null;
	}
	return <AppMessage text={appMessage.text} actions={appMessage.actions} onClose={hideAppMessage} />;
}
