import {type ReactNode, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

interface TooltipProps {
	/** The content to show in the tooltip */
	content: ReactNode;
	/** The element that triggers the tooltip */
	children: ReactNode;
	/** Optional keyboard shortcut to display */
	shortcut?: string;
	/** Placement of the tooltip relative to the trigger */
	placement?: 'top' | 'bottom';
	/** Delay before showing tooltip in ms */
	delay?: number;
}

/**
 * Custom tooltip component matching Workflowy's Tippy.js styled tooltips.
 * Features:
 * - Dark background with light text
 * - Arrow pointing to trigger element
 * - Optional keyboard shortcut display
 * - Fade animation
 * - Positioned below element by default
 * - Viewport-aware positioning (stays within bounds)
 */
export function Tooltip({content, children, shortcut, placement = 'bottom', delay = 200}: TooltipProps) {
	const [isVisible, setIsVisible] = useState(false);
	const [isPositioned, setIsPositioned] = useState(false);
	const [position, setPosition] = useState({top: 0, left: 0, arrowLeft: 0});
	const triggerRef = useRef<HTMLDivElement>(null);
	const tooltipRef = useRef<HTMLDivElement>(null);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const showTooltip = () => {
		timeoutRef.current = globalThis.setTimeout(() => {
			setIsVisible(true);
			setIsPositioned(false);
		}, delay);
	};

	const hideTooltip = () => {
		if (timeoutRef.current !== null) {
			clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
		setIsVisible(false);
		setIsPositioned(false);
	};

	// Use useLayoutEffect to measure and position before paint
	useLayoutEffect(() => {
		if (isVisible && triggerRef.current && tooltipRef.current) {
			const triggerRect = triggerRef.current.getBoundingClientRect();
			const tooltipEl = tooltipRef.current;
			const tooltipWidth = tooltipEl.offsetWidth;
			const tooltipHeight = tooltipEl.offsetHeight;
			const viewportWidth = window.innerWidth;
			const padding = 8;

			// Calculate ideal center position
			const idealLeft = triggerRect.left + triggerRect.width / 2;

			// Calculate tooltip bounds if centered
			const tooltipHalfWidth = tooltipWidth / 2;
			let left = idealLeft;
			let arrowLeft = tooltipHalfWidth;

			// Adjust if tooltip would go off left edge
			if (idealLeft - tooltipHalfWidth < padding) {
				left = padding + tooltipHalfWidth;
				arrowLeft = idealLeft - padding;
			}

			// Adjust if tooltip would go off right edge
			if (idealLeft + tooltipHalfWidth > viewportWidth - padding) {
				left = viewportWidth - padding - tooltipHalfWidth;
				arrowLeft = tooltipWidth - (viewportWidth - idealLeft - padding);
			}

			// Calculate top position
			const top = placement === 'bottom' ? triggerRect.bottom + 8 : triggerRect.top - tooltipHeight - 8;

			setPosition({top, left, arrowLeft});
			setIsPositioned(true);
		}
	}, [isVisible, placement]);

	useEffect(
		() => () => {
			if (timeoutRef.current !== null) {
				clearTimeout(timeoutRef.current);
			}
		},
		[],
	);

	const tooltipContent = (
		<div
			className={`tooltip ${isPositioned ? 'tooltip-visible' : ''} tooltip-${placement}`}
			ref={tooltipRef}
			role="tooltip"
			style={{
				top: position.top,
				left: position.left,
			}}
		>
			<div className="tooltip-content">
				<span>{content}</span>
				{shortcut && <span className="tooltip-shortcut">{shortcut}</span>}
			</div>
			<div
				className="tooltip-arrow"
				style={{left: position.arrowLeft}}
			/>
		</div>
	);

	return (
		<div
			className="tooltip-trigger"
			onMouseEnter={showTooltip}
			onMouseLeave={hideTooltip}
			ref={triggerRef}
		>
			{children}
			{isVisible && createPortal(tooltipContent, document.body)}
		</div>
	);
}
