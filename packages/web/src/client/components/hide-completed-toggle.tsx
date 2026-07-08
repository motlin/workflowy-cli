import {type RefObject, useEffect, useRef} from 'react';

interface HideCompletedToggleProps {
	anchorRef: RefObject<HTMLButtonElement | null>;
	isOpen: boolean;
	onClose: () => void;
	onToggle: () => void;
	showCompleted: boolean;
}

/**
 * Popup panel with toggle switch for showing/hiding completed items.
 * Matches Workflowy's production toggle popup design.
 */
export function HideCompletedToggle({anchorRef, isOpen, onClose, onToggle, showCompleted}: HideCompletedToggleProps) {
	const panelRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!isOpen) return;

		function handleClickOutside(event: MouseEvent) {
			const target = event.target as Node;
			if (
				panelRef.current &&
				!panelRef.current.contains(target) &&
				anchorRef.current &&
				!anchorRef.current.contains(target)
			) {
				onClose();
			}
		}

		function handleEscape(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				onClose();
			}
		}

		document.addEventListener('mousedown', handleClickOutside);
		document.addEventListener('keydown', handleEscape);

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
			document.removeEventListener('keydown', handleEscape);
		};
	}, [isOpen, onClose, anchorRef]);

	if (!isOpen) return null;

	const handleToggleClick = () => {
		onToggle();
	};

	return (
		<div
			className="hide-completed-popup"
			ref={panelRef}
		>
			<label className={`toggle-switch-label ${showCompleted ? 'on' : 'off'}`}>
				<button
					aria-checked={showCompleted}
					className="toggle-switch-track"
					onClick={handleToggleClick}
					role="switch"
					type="button"
				>
					<span className="toggle-switch-thumb" />
				</button>
				<span className="toggle-switch-text">Show completed</span>
			</label>
		</div>
	);
}
