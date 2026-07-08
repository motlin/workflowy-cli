import {useEffect, useRef} from 'react';
import {useOutlineStore} from '../stores/outline.js';

interface GearMenuProps {
	isOpen: boolean;
	onClose: () => void;
	onOpenSettings: () => void;
	onExpandAll: () => void;
	onCollapseAll: () => void;
}

interface MenuItemProps {
	icon: React.ReactNode;
	label: string;
	shortcut?: string;
	onClick?: () => void;
	disabled?: boolean;
	subtitle?: string;
	hasNotificationDot?: boolean;
}

function MenuItem({
	icon,
	label,
	shortcut,
	onClick,
	disabled = false,
	subtitle,
	hasNotificationDot = false,
}: MenuItemProps) {
	return (
		<button
			className={`gear-menu-item ${disabled ? 'disabled' : ''}`}
			disabled={disabled}
			onClick={onClick}
			type="button"
		>
			<span className="gear-menu-item-content">
				{hasNotificationDot && <span className="gear-menu-notification-dot" />}
				<span className="gear-menu-item-icon">{icon}</span>
				<span className="gear-menu-item-label">{label}</span>
			</span>
			{shortcut && <span className="gear-menu-item-shortcut">{shortcut}</span>}
			{subtitle && <span className="gear-menu-item-subtitle">{subtitle}</span>}
		</button>
	);
}

function MenuDivider() {
	return <div className="gear-menu-divider" />;
}

// Icon components
function ClipboardListIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 384 512"
			width="14"
		>
			<path d="M192 0c-41.8 0-77.4 26.7-90.5 64L64 64C28.7 64 0 92.7 0 128L0 448c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-320c0-35.3-28.7-64-64-64l-37.5 0C269.4 26.7 233.8 0 192 0zm0 64a32 32 0 1 1 0 64 32 32 0 1 1 0-64zM72 272a24 24 0 1 1 48 0 24 24 0 1 1 -48 0zm104-16l128 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-128 0c-8.8 0-16-7.2-16-16s7.2-16 16-16zM72 368a24 24 0 1 1 48 0 24 24 0 1 1 -48 0zm104-16l128 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-128 0c-8.8 0-16-7.2-16-16s7.2-16 16-16z" />
		</svg>
	);
}

function ChalkboardUserIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 640 512"
			width="14"
		>
			<path d="M160 64c0-35.3 28.7-64 64-64L576 0c35.3 0 64 28.7 64 64l0 288c0 35.3-28.7 64-64 64l-239.2 0c-12.6-28.6-37.5-51.5-68.7-63.1l21.6-21.6c14.3-14.3 22.3-33.7 22.3-53.9l0-37.4 0-128c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 128-32 0 0-128c0-53 43-96 96-96s96 43 96 96l0 128 0 37.4c0 5.2-.8 10.2-2.4 14.9l-6.4 19.2c-1.3 3.8 .8 7.9 4.5 9.4s7.9-.5 9.4-4.2l15.2-38.1c6.5-16.2 15.5-31.1 26.7-44.4l89.6-107.6c8.5-10.2 7.1-25.3-3.1-33.8s-25.3-7.1-33.8 3.1L464 201.6l0 118.4 80 0 0-256L256 64l0 128-32 0 0-128 0-32-64 0 0 32 0 128-32 0 0-128c0-35.3 28.7-64 64-64l-32 0zm0 384a96 96 0 1 0 0-192 96 96 0 1 0 0 192z" />
		</svg>
	);
}

function BoltIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 448 512"
			width="14"
		>
			<path d="M349.4 44.6c5.9-13.7 1.5-29.7-10.6-38.5s-28.6-8-39.9 1.8l-256 224c-10 8.8-13.6 22.9-8.9 35.3S50.7 288 64 288l111.5 0L98.6 467.4c-5.9 13.7-1.5 29.7 10.6 38.5s28.6 8 39.9-1.8l256-224c10-8.8 13.6-22.9 8.9-35.3s-16.6-20.7-30-20.7l-111.5 0L349.4 44.6z" />
		</svg>
	);
}

function UndoIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 512 512"
			width="14"
		>
			<path d="M125.7 160l50.3 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L48 224c-17.7 0-32-14.3-32-32L16 64c0-17.7 14.3-32 32-32s32 14.3 32 32l0 51.2L97.6 97.6c87.5-87.5 229.3-87.5 316.8 0s87.5 229.3 0 316.8s-229.3 87.5-316.8 0c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0c62.5 62.5 163.8 62.5 226.3 0s62.5-163.8 0-226.3s-163.8-62.5-226.3 0L125.7 160z" />
		</svg>
	);
}

function RedoIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 512 512"
			width="14"
		>
			<path d="M386.3 160l-50.3 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l128 0c17.7 0 32-14.3 32-32l0-128c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 51.2L414.4 97.6c-87.5-87.5-229.3-87.5-316.8 0s-87.5 229.3 0 316.8s229.3 87.5 316.8 0c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0c-62.5 62.5-163.8 62.5-226.3 0s-62.5-163.8 0-226.3s163.8-62.5 226.3 0L386.3 160z" />
		</svg>
	);
}

function SyncIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 512 512"
			width="14"
		>
			<path d="M105.1 202.6c7.7-21.8 20.2-42.3 37.8-59.8c62.5-62.5 163.8-62.5 226.3 0L386.3 160 336 160c-17.7 0-32 14.3-32 32s14.3 32 32 32l128 0c17.7 0 32-14.3 32-32l0-128c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 51.2L414.4 97.6c-87.5-87.5-229.3-87.5-316.8 0C73.2 122 55.6 150.7 44.8 181.4c-5.9 16.7 2.9 34.9 19.5 40.8s34.9-2.9 40.8-19.5zM39 289.3c-5 1.5-9.8 4.2-13.7 8.2c-4 4-6.7 8.8-8.1 14c-3.7 13.9 .5 28.4 12.1 37.5l.1 .1 .2 .1 .6 .5 2.1 1.8c1.8 1.5 4.3 3.5 7.4 6c6.3 5 15.1 11.8 25.9 19.6c21.7 15.8 51.5 35.6 84.5 54.1c65.6 36.7 147.2 68.8 209.5 54c16.9-4 27.1-21.2 23.1-38.1s-21.2-27.1-38.1-23.1c-37.7 9-100.4-10.8-162.3-45.4c-30.6-17.1-58-35.3-77.8-49.9c-9.9-7.3-17.7-13.5-23-17.8c-2.7-2.2-4.7-3.9-6-5l-.8-.7-.1-.1c-18.1-15.4-44.8-14.2-61.5 3.5c-9.4 9.9-13 23.1-10.8 35.3zm372.9 20.1c-5.9-16.7-24.2-25.4-40.8-19.5c-16.7 5.9-25.4 24.2-19.5 40.8c10.8 30.6 9.2 63.4-5.8 93.2c-14.2 28.2-38.7 50.3-69.8 62.1c-16.7 6.3-25 25-18.7 41.7s25 25 41.7 18.7c49.5-18.8 88.5-53.5 107.7-95.5c18.3-40.1 20.4-85.8 5.1-128.3z" />
		</svg>
	);
}

function ExpandIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 512 512"
			width="14"
		>
			<path d="M344 0L488 0c13.3 0 24 10.7 24 24l0 144c0 9.7-5.8 18.5-14.8 22.2s-19.3 1.7-26.2-5.2l-39-39-87 87c-9.4 9.4-24.6 9.4-33.9 0l-32-32c-9.4-9.4-9.4-24.6 0-33.9l87-87L327 41c-6.9-6.9-8.9-17.2-5.2-26.2S334.3 0 344 0zM168 512L24 512c-13.3 0-24-10.7-24-24L0 344c0-9.7 5.8-18.5 14.8-22.2s19.3-1.7 26.2 5.2l39 39 87-87c9.4-9.4 24.6-9.4 33.9 0l32 32c9.4 9.4 9.4 24.6 0 33.9l-87 87 39 39c6.9 6.9 8.9 17.2 5.2 26.2s-12.5 14.8-22.2 14.8z" />
		</svg>
	);
}

function CollapseIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 512 512"
			width="14"
		>
			<path d="M439 7c9.4-9.4 24.6-9.4 33.9 0l32 32c9.4 9.4 9.4 24.6 0 33.9l-87 87 39 39c6.9 6.9 8.9 17.2 5.2 26.2s-12.5 14.8-22.2 14.8l-144 0c-13.3 0-24-10.7-24-24l0-144c0-9.7 5.8-18.5 14.8-22.2s19.3-1.7 26.2 5.2l39 39L439 7zM72 272l144 0c13.3 0 24 10.7 24 24l0 144c0 9.7-5.8 18.5-14.8 22.2s-19.3 1.7-26.2-5.2l-39-39L73 505c-9.4 9.4-24.6 9.4-33.9 0L7 473c-9.4-9.4-9.4-24.6 0-33.9l87-87L55 313c-6.9-6.9-8.9-17.2-5.2-26.2s12.5-14.8 22.2-14.8z" />
		</svg>
	);
}

function PrintIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 512 512"
			width="14"
		>
			<path d="M128 0C92.7 0 64 28.7 64 64l0 96 64 0 0-96 226.7 0L384 93.3l0 66.7 64 0 0-66.7c0-17-6.7-33.3-18.7-45.3L400 18.7C388 6.7 371.7 0 354.7 0L128 0zM384 352l0 96L128 448l0-96 256 0zm64 0l32 0c17.7 0 32-14.3 32-32l0-96c0-35.3-28.7-64-64-64L64 160c-35.3 0-64 28.7-64 64l0 96c0 17.7 14.3 32 32 32l32 0 0-32c0-17.7 14.3-32 32-32l256 0c17.7 0 32 14.3 32 32l0 32zm-16-88a24 24 0 1 0 0-48 24 24 0 1 0 0 48zM128 512l256 0c35.3 0 64-28.7 64-64l0-64-384 0 0 64c0 35.3 28.7 64 64 64z" />
		</svg>
	);
}

function ExportIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 576 512"
			width="14"
		>
			<path d="M0 64C0 28.7 28.7 0 64 0L224 0l0 128c0 17.7 14.3 32 32 32l128 0 0 128-168 0c-13.3 0-24 10.7-24 24s10.7 24 24 24l168 0 0 112c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 64zM384 336l0-48 110.1 0-39-39c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l80 80c9.4 9.4 9.4 24.6 0 33.9l-80 80c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l39-39L384 336zm0-208l0-128L256 128l128 0z" />
		</svg>
	);
}

function DownloadIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 384 512"
			width="14"
		>
			<path d="M64 0C28.7 0 0 28.7 0 64L0 448c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-288-128 0c-17.7 0-32-14.3-32-32L224 0 64 0zM256 0l0 128 128 0L256 0zM216 232l0 102.1 31-31c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-72 72c-9.4 9.4-24.6 9.4-33.9 0l-72-72c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l31 31L168 232c0-13.3 10.7-24 24-24s24 10.7 24 24z" />
		</svg>
	);
}

function GearIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 512 512"
			width="14"
		>
			<path d="M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8c-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6 .3-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.2-9.6-15.9-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z" />
		</svg>
	);
}

function HelpIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 512 512"
			width="14"
		>
			<path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM169.8 165.3c7.9-22.3 29.1-37.3 52.8-37.3l58.3 0c34.9 0 63.1 28.3 63.1 63.1c0 22.6-12.1 43.5-31.7 54.8L280 264.4c-.2 13-10.9 23.6-24 23.6c-13.3 0-24-10.7-24-24l0-13.5c0-8.6 4.6-16.5 12.1-20.8l44.3-25.4c4.7-2.7 7.6-7.7 7.6-13.1c0-8.4-6.8-15.1-15.1-15.1l-58.3 0c-3.4 0-6.4 2.1-7.5 5.3l-.4 1.2c-4.4 12.5-18.2 19-30.6 14.6s-19-18.2-14.6-30.6l.4-1.2zM224 352a32 32 0 1 1 64 0 32 32 0 1 1 -64 0z" />
		</svg>
	);
}

function BugIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 512 512"
			width="14"
		>
			<path d="M256 0c53 0 96 43 96 96l0 3.6c0 15.7-12.7 28.4-28.4 28.4l-135.1 0c-15.7 0-28.4-12.7-28.4-28.4l0-3.6c0-53 43-96 96-96zM41.4 105.4c12.5-12.5 32.8-12.5 45.3 0l64 64c.7 .7 1.3 1.4 1.9 2.1c14.2-7.3 30.4-11.4 47.5-11.4l112 0c17.1 0 33.2 4.1 47.5 11.4c.6-.7 1.2-1.4 1.9-2.1l64-64c12.5-12.5 32.8-12.5 45.3 0s12.5 32.8 0 45.3l-64 64c-.7 .7-1.4 1.3-2.1 1.9c6.2 12 10.1 25.3 11.1 39.5l64.3 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-64 0 0 32 64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-64.3 0c-1.1 14.1-5 27.5-11.1 39.5c.7 .6 1.4 1.2 2.1 1.9l64 64c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0l-64-64c-.7-.7-1.3-1.4-1.9-2.1C289.2 411.9 273.1 416 256 416s-33.2-4.1-47.5-11.4c-.6 .7-1.2 1.4-1.9 2.1l-64 64c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3l64-64c.7-.7 1.4-1.3 2.1-1.9c-6.2-12-10.1-25.3-11.1-39.5L88 320c-17.7 0-32-14.3-32-32s14.3-32 32-32l64.3 0 0-32L88 224c-17.7 0-32-14.3-32-32s14.3-32 32-32l64.3 0c1.1-14.1 5-27.5 11.1-39.5c-.7-.6-1.4-1.2-2.1-1.9l-64-64c-12.5-12.5-12.5-32.8 0-45.3z" />
		</svg>
	);
}

function TrashIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 448 512"
			width="14"
		>
			<path d="M170.5 51.6L151.5 80l145 0-19-28.4c-1.5-2.2-4-3.6-6.7-3.6l-93.7 0c-2.7 0-5.2 1.3-6.7 3.6zm147-26.6L354.2 80 368 80l48 0 8 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-8 0 0 304c0 44.2-35.8 80-80 80l-224 0c-44.2 0-80-35.8-80-80l0-304-8 0c-13.3 0-24-10.7-24-24S10.7 80 24 80l8 0 48 0 13.8 0 36.7-55.1C140.9 9.4 158.4 0 177.1 0l93.7 0c18.7 0 36.2 9.4 46.6 24.9zM80 128l0 304c0 17.7 14.3 32 32 32l224 0c17.7 0 32-14.3 32-32l0-304L80 128zm80 64l0 208c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-208c0-8.8 7.2-16 16-16s16 7.2 16 16zm80 0l0 208c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-208c0-8.8 7.2-16 16-16s16 7.2 16 16zm80 0l0 208c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-208c0-8.8 7.2-16 16-16s16 7.2 16 16z" />
		</svg>
	);
}

function LogoutIcon() {
	return (
		<svg
			fill="currentColor"
			height="14"
			viewBox="0 0 512 512"
			width="14"
		>
			<path d="M377.9 105.9L500.7 228.7c7.2 7.2 11.3 17.1 11.3 27.3s-4.1 20.1-11.3 27.3L377.9 406.1c-6.4 6.4-15 9.9-24 9.9c-18.7 0-33.9-15.2-33.9-33.9l0-62.1-128 0c-17.7 0-32-14.3-32-32l0-64c0-17.7 14.3-32 32-32l128 0 0-62.1c0-18.7 15.2-33.9 33.9-33.9c9 0 17.6 3.6 24 9.9zM160 96L96 96c-17.7 0-32 14.3-32 32l0 256c0 17.7 14.3 32 32 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-64 0c-53 0-96-43-96-96L0 128C0 75 43 32 96 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32z" />
		</svg>
	);
}

/**
 * Gear menu dropdown component matching Workflowy's production menu.
 * Contains options like What's New, Settings, Help, etc.
 */
export function GearMenu({isOpen, onClose, onOpenSettings, onExpandAll, onCollapseAll}: GearMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);
	const openExportDialog = useOutlineStore((state) => state.openExportDialog);

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

		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside);
			document.addEventListener('keydown', handleEscape);
		}

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
			document.removeEventListener('keydown', handleEscape);
		};
	}, [isOpen, onClose]);

	if (!isOpen) {
		return null;
	}

	const handleExportAll = () => {
		openExportDialog({nodeIds: []});
		onClose();
	};

	const handleExpandAll = () => {
		onExpandAll();
		onClose();
	};

	const handleCollapseAll = () => {
		onCollapseAll();
		onClose();
	};

	const handlePrint = () => {
		globalThis.print();
		onClose();
	};

	const handleSettings = () => {
		onOpenSettings();
		onClose();
	};

	return (
		<div
			className="gear-menu"
			ref={menuRef}
		>
			<div className="gear-menu-scroller">
				<MenuItem
					hasNotificationDot
					icon={<ClipboardListIcon />}
					label="What's New"
				/>
				<MenuItem
					icon={<ChalkboardUserIcon />}
					label="Learn WorkFlowy"
				/>

				<MenuDivider />

				<MenuItem
					icon={<BoltIcon />}
					label="Connect Apps with Zapier"
				/>

				<MenuDivider />

				<MenuItem
					disabled
					icon={<UndoIcon />}
					label="Undo"
					shortcut="⌘Z"
				/>
				<MenuItem
					disabled
					icon={<RedoIcon />}
					label="Redo"
					shortcut="⇧⌘Z"
				/>
				<MenuItem
					disabled
					icon={<SyncIcon />}
					label="Save"
					shortcut="⌘S"
					subtitle="Autosaved just now"
				/>

				<MenuDivider />

				<MenuItem
					icon={<ExpandIcon />}
					label="Expand all"
					onClick={handleExpandAll}
				/>
				<MenuItem
					icon={<CollapseIcon />}
					label="Collapse all"
					onClick={handleCollapseAll}
				/>
				<MenuItem
					icon={<PrintIcon />}
					label="Print"
					onClick={handlePrint}
					shortcut="⌘P"
				/>
				<MenuItem
					icon={<ExportIcon />}
					label="Export all"
					onClick={handleExportAll}
				/>
				<MenuItem
					icon={<DownloadIcon />}
					label="Download Files"
				/>

				<MenuDivider />

				<MenuItem
					icon={<GearIcon />}
					label="Settings"
					onClick={handleSettings}
				/>
				<MenuItem
					icon={<HelpIcon />}
					label="Help"
				/>
				<MenuItem
					icon={<BugIcon />}
					label="Report a problem"
				/>
				<MenuItem
					icon={<TrashIcon />}
					label="Trash"
				/>

				<MenuDivider />

				<MenuItem
					icon={<LogoutIcon />}
					label="Log out"
					subtitle="user@example.com"
				/>
			</div>
		</div>
	);
}
