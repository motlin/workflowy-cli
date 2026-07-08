import {useEffect, useRef} from 'react';
import {createPortal} from 'react-dom';

/**
 * Available layout modes matching Workflowy's item type picker.
 * These correspond to the layoutMode values in the node data.
 */
export type LayoutMode =
	| 'bullets'
	| 'h1'
	| 'h2'
	| 'h3'
	| 'paragraph'
	| 'todo'
	| 'numbered'
	| 'board'
	| 'quote'
	| 'code-block'
	| 'divider';

interface LayoutOption {
	id: LayoutMode;
	label: string;
	icon: React.ReactNode;
}

/**
 * SVG icon for list/bullets layout.
 */
function BulletsIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 512 512"
			width="14"
		>
			<path d="M64 64a32 32 0 1 0 0 64 32 32 0 1 0 0-64zM176 80c-8.8 0-16 7.2-16 16s7.2 16 16 16l320 0c8.8 0 16-7.2 16-16s-7.2-16-16-16L176 80zm0 160c-8.8 0-16 7.2-16 16s7.2 16 16 16l320 0c8.8 0 16-7.2 16-16s-7.2-16-16-16l-320 0zm0 160c-8.8 0-16 7.2-16 16s7.2 16 16 16l320 0c8.8 0 16-7.2 16-16s-7.2-16-16-16l-320 0zM64 224a32 32 0 1 0 0 64 32 32 0 1 0 0-64zm0 160a32 32 0 1 0 0 64 32 32 0 1 0 0-64z" />
		</svg>
	);
}

/**
 * SVG icon for Heading 1.
 */
function H1Icon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 576 512"
			width="14"
		>
			<path d="M32 80c0-8.8-7.2-16-16-16S0 71.2 0 80L0 256 0 432c0 8.8 7.2 16 16 16s16-7.2 16-16l0-160 256 0 0 160c0 8.8 7.2 16 16 16s16-7.2 16-16l0-176 0-176c0-8.8-7.2-16-16-16s-16 7.2-16 16l0 160L32 240 32 80zm464 0c0-5.7-3-10.9-7.9-13.8s-10.9-2.9-15.9-.2l-72 40c-7.7 4.3-10.5 14-6.2 21.8s14 10.5 21.8 6.2L464 107.2 464 416l-64 0c-8.8 0-16 7.2-16 16s7.2 16 16 16l80 0 80 0c8.8 0 16-7.2 16-16s-7.2-16-16-16l-64 0 0-336z" />
		</svg>
	);
}

/**
 * SVG icon for Heading 2.
 */
function H2Icon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 640 512"
			width="14"
		>
			<path d="M32 80c0-8.8-7.2-16-16-16S0 71.2 0 80L0 256 0 432c0 8.8 7.2 16 16 16s16-7.2 16-16l0-160 256 0 0 160c0 8.8 7.2 16 16 16s16-7.2 16-16l0-176 0-176c0-8.8-7.2-16-16-16s-16 7.2-16 16l0 160L32 240 32 80zm448 32c26.5 0 48 21.5 48 48c0 16-8 30.9-21.3 39.8l-122.3 81.6c-13 8.7-20.3 23.4-20.3 39l0 27.5c0 8.8 7.2 16 16 16l176 0c8.8 0 16-7.2 16-16s-7.2-16-16-16l-158.4 0 0-11.5c0-5.2 2.4-10.1 6.8-13l122.3-81.6C551.9 211.8 560 188.7 560 160c0-44.2-35.8-80-80-80l-64 0c-44.2 0-80 35.8-80 80l0 16c0 8.8 7.2 16 16 16s16-7.2 16-16l0-16c0-26.5 21.5-48 48-48l64 0z" />
		</svg>
	);
}

/**
 * SVG icon for Heading 3.
 */
function H3Icon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 640 512"
			width="14"
		>
			<path d="M32 80c0-8.8-7.2-16-16-16S0 71.2 0 80L0 256 0 432c0 8.8 7.2 16 16 16s16-7.2 16-16l0-160 256 0 0 160c0 8.8 7.2 16 16 16s16-7.2 16-16l0-176 0-176c0-8.8-7.2-16-16-16s-16 7.2-16 16l0 160L32 240 32 80zm448 32c26.5 0 48 21.5 48 48c0 19.3-11.4 36.6-29.1 44.2c-7.3 3.2-11 11.5-8.4 19.1l.1 .3c2.8 8.4 11.7 12.7 20 9.7C543.7 222.5 560 193.3 560 160c0-44.2-35.8-80-80-80l-64 0c-44.2 0-80 35.8-80 80l0 16c0 8.8 7.2 16 16 16s16-7.2 16-16l0-16c0-26.5 21.5-48 48-48l64 0zm0 288l-64 0c-26.5 0-48-21.5-48-48l0-16c0-8.8-7.2-16-16-16s-16 7.2-16 16l0 16c0 44.2 35.8 80 80 80l64 0c44.2 0 80-35.8 80-80c0-33.3-16.3-62.5-43.4-73.3c-8.3-3.3-17.5 1-20.3 9.3c-2.8 8.3 1 17.5 9.3 20.3C527.9 315.3 528 337.1 528 352c0 26.5-21.5 48-48 48z" />
		</svg>
	);
}

/**
 * SVG icon for Paragraph.
 */
function ParagraphIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 448 512"
			width="14"
		>
			<path d="M32 192c0-88.4 71.6-160 160-160l208 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-64 0 0 400c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-400-64 0 0 400c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-192c-88.4 0-160-71.6-160-160zm160 128l0-256c-70.7 0-128 57.3-128 128s57.3 128 128 128z" />
		</svg>
	);
}

/**
 * SVG icon for To-do/checklist layout.
 */
function TodoIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 512 512"
			width="14"
		>
			<path d="M153.8 72.1c3.5-8 .3-17.4-7.6-21.3s-17.6-.6-21.6 7.2L67.2 176l-35 0c-8.5 0-16 5.4-18.8 13.4s-.5 17 6 22.6l96 80c7 5.8 17.3 5 23.3-1.8l72-80c6.1-6.8 5.5-17.4-1.3-23.4s-17.4-5.5-23.4 1.3L137.6 243.2l-46-38.3 62.2-132.8zM184 288l-96 0c-13.3 0-24 10.7-24 24l0 96c0 13.3 10.7 24 24 24l96 0c13.3 0 24-10.7 24-24l0-96c0-13.3-10.7-24-24-24zm-96-32l96 0c30.9 0 56 25.1 56 56l0 96c0 30.9-25.1 56-56 56l-96 0c-30.9 0-56-25.1-56-56l0-96c0-30.9 25.1-56 56-56zm192-48c0-8.8 7.2-16 16-16l192 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-192 0c-8.8 0-16-7.2-16-16zm0 160c0-8.8 7.2-16 16-16l192 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-192 0c-8.8 0-16-7.2-16-16z" />
		</svg>
	);
}

/**
 * SVG icon for numbered list.
 */
function NumberIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 512 512"
			width="14"
		>
			<path d="M24 56c0-13.3 10.7-24 24-24l32 0c13.3 0 24 10.7 24 24l0 120 16 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-80 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l16 0 0-96-8 0C34.7 80 24 69.3 24 56zM192 96c0-8.8 7.2-16 16-16l288 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-288 0c-8.8 0-16-7.2-16-16zm0 160c0-8.8 7.2-16 16-16l288 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-288 0c-8.8 0-16-7.2-16-16zm0 160c0-8.8 7.2-16 16-16l288 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-288 0c-8.8 0-16-7.2-16-16zM24 288c0-6.5 3.9-12.3 9.9-14.8s12.9-1.1 17.4 3.5L80 306l28.7-29.3c4.5-4.6 11.4-5.9 17.4-3.5s9.9 8.3 9.9 14.8l0 136c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-81.8L88.4 358.4c-6.3 6.4-16.5 6.4-22.8 0L50 342.2 50 424c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-136z" />
		</svg>
	);
}

/**
 * SVG icon for board/kanban layout.
 */
function BoardIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 512 512"
			width="14"
		>
			<path d="M64 64C46.3 64 32 78.3 32 96l0 320c0 17.7 14.3 32 32 32l384 0c17.7 0 32-14.3 32-32l0-320c0-17.7-14.3-32-32-32L64 64zM0 96C0 60.7 28.7 32 64 32l384 0c35.3 0 64 28.7 64 64l0 320c0 35.3-28.7 64-64 64L64 480c-35.3 0-64-28.7-64-64L0 96zm176 32l0 256c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-256c0-8.8 7.2-16 16-16s16 7.2 16 16zm176 0l0 256c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-256c0-8.8 7.2-16 16-16s16 7.2 16 16z" />
		</svg>
	);
}

/**
 * SVG icon for quote block.
 */
function QuoteIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 448 512"
			width="14"
		>
			<path d="M0 216C0 149.7 53.7 96 120 96l16 0c22.1 0 40 17.9 40 40l0 48c0 17.7-14.3 32-32 32l-64 0c-17.7 0-32 14.3-32 32l0 32c0 17.7 14.3 32 32 32l16 0c17.7 0 32 14.3 32 32l0 48c0 22.1-17.9 40-40 40l-16 0C53.7 432 0 378.3 0 312l0-96zm256 0c0-66.3 53.7-120 120-120l16 0c22.1 0 40 17.9 40 40l0 48c0 17.7-14.3 32-32 32l-64 0c-17.7 0-32 14.3-32 32l0 32c0 17.7 14.3 32 32 32l16 0c17.7 0 32 14.3 32 32l0 48c0 22.1-17.9 40-40 40l-16 0c-66.3 0-120-53.7-120-120l0-96z" />
		</svg>
	);
}

/**
 * SVG icon for code block.
 */
function CodeBlockIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 512 512"
			width="14"
		>
			<path d="M64 64C46.3 64 32 78.3 32 96l0 320c0 17.7 14.3 32 32 32l384 0c17.7 0 32-14.3 32-32l0-320c0-17.7-14.3-32-32-32L64 64zM0 96C0 60.7 28.7 32 64 32l384 0c35.3 0 64 28.7 64 64l0 320c0 35.3-28.7 64-64 64L64 480c-35.3 0-64-28.7-64-64L0 96zm283.3 139.3c6.2-6.2 6.2-16.4 0-22.6s-16.4-6.2-22.6 0l-80 80c-6.2 6.2-6.2 16.4 0 22.6l80 80c6.2 6.2 16.4 6.2 22.6 0s6.2-16.4 0-22.6L214.6 304l68.7-68.7zm54.6-22.6c-6.2 6.2-6.2 16.4 0 22.6L406.6 304l-68.7 68.7c-6.2 6.2-6.2 16.4 0 22.6s16.4 6.2 22.6 0l80-80c6.2-6.2 6.2-16.4 0-22.6l-80-80c-6.2-6.2-16.4-6.2-22.6 0z" />
		</svg>
	);
}

/**
 * SVG icon for divider/horizontal rule.
 */
function DividerIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 640 512"
			width="14"
		>
			<path d="M0 256c0-8.8 7.2-16 16-16l608 0c8.8 0 16 7.2 16 16s-7.2 16-16 16L16 272c-8.8 0-16-7.2-16-16z" />
		</svg>
	);
}

const layoutOptions: LayoutOption[] = [
	{id: 'bullets', label: 'Bullets', icon: <BulletsIcon />},
	{id: 'h1', label: 'Heading 1', icon: <H1Icon />},
	{id: 'h2', label: 'Heading 2', icon: <H2Icon />},
	{id: 'h3', label: 'Heading 3', icon: <H3Icon />},
	{id: 'paragraph', label: 'Paragraph', icon: <ParagraphIcon />},
	{id: 'todo', label: 'To-do', icon: <TodoIcon />},
	{id: 'numbered', label: 'Number', icon: <NumberIcon />},
	{id: 'board', label: 'Board', icon: <BoardIcon />},
	{id: 'quote', label: 'Quote', icon: <QuoteIcon />},
	{id: 'code-block', label: 'Code Block', icon: <CodeBlockIcon />},
	{id: 'divider', label: 'Divider', icon: <DividerIcon />},
];

interface LayoutMenuProps {
	position: {top: number; right: number};
	onSelect: (layout: LayoutMode) => void;
	onClose: () => void;
	currentLayout: string | null;
}

/**
 * Layout menu dropdown for changing node layout modes.
 * Matches Workflowy's item type picker menu design.
 */
export function LayoutMenu({position, onSelect, onClose, currentLayout}: LayoutMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
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
	}, [onClose]);

	const handleSelect = (layout: LayoutMode) => {
		onSelect(layout);
		onClose();
	};

	const menu = (
		<div
			className="layout-menu"
			ref={menuRef}
			style={{top: position.top, right: position.right}}
		>
			{layoutOptions.map((option) => (
				<button
					className={`layout-menu-item ${currentLayout === option.id ? 'active' : ''}`}
					key={option.id}
					onClick={() => handleSelect(option.id)}
					type="button"
				>
					<span className="layout-menu-item-icon">{option.icon}</span>
					<span className="layout-menu-item-label">{option.label}</span>
				</button>
			))}
		</div>
	);

	return createPortal(menu, document.body);
}
