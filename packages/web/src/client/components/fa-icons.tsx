import type {CSSProperties} from "react";

export interface FaIconDefinition {
	prefix: "fal" | "fas" | "far";
	name: string;
	width: number;
	height: number;
	d: string;
}

/**
 * FontAwesome 6 icon definitions extracted from upstream's wf-base bundle,
 * keyed `"<prefix>:<name>"`.
 */
// oxlint-disable-next-line react/only-export-components -- the icon map is the shared API other menus extend; it never changes at runtime
export const FA_ICONS = {
	"fal:bars": {
		prefix: "fal",
		name: "bars",
		width: 448,
		height: 512,
		d: "M0 80c0-8.8 7.2-16 16-16l416 0c8.8 0 16 7.2 16 16s-7.2 16-16 16L16 96C7.2 96 0 88.8 0 80zM0 240c0-8.8 7.2-16 16-16l416 0c8.8 0 16 7.2 16 16s-7.2 16-16 16L16 256c-8.8 0-16-7.2-16-16zM448 400c0 8.8-7.2 16-16 16L16 416c-8.8 0-16-7.2-16-16s7.2-16 16-16l416 0c8.8 0 16 7.2 16 16z",
	},
	"fal:chevron-left": {
		prefix: "fal",
		name: "chevron-left",
		width: 320,
		height: 512,
		d: "M20.7 267.3c-6.2-6.2-6.2-16.4 0-22.6l192-192c6.2-6.2 16.4-6.2 22.6 0s6.2 16.4 0 22.6L54.6 256 235.3 436.7c6.2 6.2 6.2 16.4 0 22.6s-16.4 6.2-22.6 0l-192-192z",
	},
	"fal:chevron-right": {
		prefix: "fal",
		name: "chevron-right",
		width: 320,
		height: 512,
		d: "M299.3 244.7c6.2 6.2 6.2 16.4 0 22.6l-192 192c-6.2 6.2-16.4 6.2-22.6 0s-6.2-16.4 0-22.6L265.4 256 84.7 75.3c-6.2-6.2-6.2-16.4 0-22.6s16.4-6.2 22.6 0l192 192z",
	},
	"fal:house": {
		prefix: "fal",
		name: "house",
		width: 576,
		height: 512,
		d: "M298.6 4c-6-5.3-15.1-5.3-21.2 0L5.4 244c-6.6 5.8-7.3 16-1.4 22.6s16 7.3 22.6 1.4L64 235l0 197c0 44.2 35.8 80 80 80l288 0c44.2 0 80-35.8 80-80l0-197 37.4 33c6.6 5.8 16.7 5.2 22.6-1.4s5.2-16.7-1.4-22.6L298.6 4zM96 432l0-225.3L288 37.3 480 206.7 480 432c0 26.5-21.5 48-48 48l-64 0 0-160c0-17.7-14.3-32-32-32l-96 0c-17.7 0-32 14.3-32 32l0 160-64 0c-26.5 0-48-21.5-48-48zm144 48l0-160 96 0 0 160-96 0z",
	},
	"fal:calendar-day": {
		prefix: "fal",
		name: "calendar-day",
		width: 448,
		height: 512,
		d: "M128 16c0-8.8-7.2-16-16-16s-16 7.2-16 16l0 48L64 64C28.7 64 0 92.7 0 128l0 32 0 32L0 448c0 35.3 28.7 64 64 64l320 0c35.3 0 64-28.7 64-64l0-256 0-32 0-32c0-35.3-28.7-64-64-64l-32 0 0-48c0-8.8-7.2-16-16-16s-16 7.2-16 16l0 48L128 64l0-48zM32 192l384 0 0 256c0 17.7-14.3 32-32 32L64 480c-17.7 0-32-14.3-32-32l0-256zM64 96l320 0c17.7 0 32 14.3 32 32l0 32L32 160l0-32c0-17.7 14.3-32 32-32zm40 160l80 0c4.4 0 8 3.6 8 8l0 80c0 4.4-3.6 8-8 8l-80 0c-4.4 0-8-3.6-8-8l0-80c0-4.4 3.6-8 8-8zm-40 8l0 80c0 22.1 17.9 40 40 40l80 0c22.1 0 40-17.9 40-40l0-80c0-22.1-17.9-40-40-40l-80 0c-22.1 0-40 17.9-40 40z",
	},
	"fal:user-plus": {
		prefix: "fal",
		name: "user-plus",
		width: 640,
		height: 512,
		d: "M224 32a96 96 0 1 1 0 192 96 96 0 1 1 0-192zm0 224A128 128 0 1 0 224 0a128 128 0 1 0 0 256zm-45.7 80l91.4 0c80 0 145 64.3 146.3 144L32 480c1.2-79.7 66.2-144 146.3-144zm0-32C79.8 304 0 383.8 0 482.3C0 498.7 13.3 512 29.7 512l388.6 0c16.4 0 29.7-13.3 29.7-29.7C448 383.8 368.2 304 269.7 304l-91.4 0zM512 304c0 8.8 7.2 16 16 16s16-7.2 16-16l0-80 80 0c8.8 0 16-7.2 16-16s-7.2-16-16-16l-80 0 0-80c0-8.8-7.2-16-16-16s-16 7.2-16 16l0 80-80 0c-8.8 0-16 7.2-16 16s7.2 16 16 16l80 0 0 80z",
	},
	"fal:play": {
		prefix: "fal",
		name: "play",
		width: 384,
		height: 512,
		d: "M56.3 66.3c-4.9-3-11.1-3.1-16.2-.3s-8.2 8.2-8.2 14l0 352c0 5.8 3.1 11.1 8.2 14s11.2 2.7 16.2-.3l288-176c4.8-2.9 7.7-8.1 7.7-13.7s-2.9-10.7-7.7-13.7l-288-176zM24.5 38.1C39.7 29.6 58.2 30 73 39L361 215c14.3 8.7 23 24.2 23 41s-8.7 32.2-23 41L73 473c-14.8 9.1-33.4 9.4-48.5 .9S0 449.4 0 432L0 80C0 62.6 9.4 46.6 24.5 38.1z",
	},
	"fal:check": {
		prefix: "fal",
		name: "check",
		width: 448,
		height: 512,
		d: "M443.3 100.7c6.2 6.2 6.2 16.4 0 22.6l-272 272c-6.2 6.2-16.4 6.2-22.6 0l-144-144c-6.2-6.2-6.2-16.4 0-22.6s16.4-6.2 22.6 0L160 361.4 420.7 100.7c6.2-6.2 16.4-6.2 22.6 0z",
	},
	"fal:list-ul": {
		prefix: "fal",
		name: "list-ul",
		width: 512,
		height: 512,
		d: "M64 64a32 32 0 1 0 0 64 32 32 0 1 0 0-64zM176 80c-8.8 0-16 7.2-16 16s7.2 16 16 16l320 0c8.8 0 16-7.2 16-16s-7.2-16-16-16L176 80zm0 160c-8.8 0-16 7.2-16 16s7.2 16 16 16l320 0c8.8 0 16-7.2 16-16s-7.2-16-16-16l-320 0zm0 160c-8.8 0-16 7.2-16 16s7.2 16 16 16l320 0c8.8 0 16-7.2 16-16s-7.2-16-16-16l-320 0zM96 256a32 32 0 1 0 -64 0 32 32 0 1 0 64 0zM64 384a32 32 0 1 0 0 64 32 32 0 1 0 0-64z",
	},
	"fal:ellipsis-vertical": {
		prefix: "fal",
		name: "ellipsis-vertical",
		width: 128,
		height: 512,
		d: "M64 384a32 32 0 1 0 0 64 32 32 0 1 0 0-64zm0-160a32 32 0 1 0 0 64 32 32 0 1 0 0-64zM96 96A32 32 0 1 0 32 96a32 32 0 1 0 64 0z",
	},
	"fal:ellipsis": {
		prefix: "fal",
		name: "ellipsis",
		width: 448,
		height: 512,
		d: "M416 256a32 32 0 1 1 -64 0 32 32 0 1 1 64 0zm-160 0a32 32 0 1 1 -64 0 32 32 0 1 1 64 0zM64 288a32 32 0 1 1 0-64 32 32 0 1 1 0 64z",
	},
	"fal:arrow-left": {
		prefix: "fal",
		name: "arrow-left",
		width: 448,
		height: 512,
		d: "M4.7 244.7c-6.2 6.2-6.2 16.4 0 22.6l176 176c6.2 6.2 16.4 6.2 22.6 0s6.2-16.4 0-22.6L54.6 272 432 272c8.8 0 16-7.2 16-16s-7.2-16-16-16L54.6 240 203.3 91.3c6.2-6.2 6.2-16.4 0-22.6s-16.4-6.2-22.6 0l-176 176z",
	},
	"fal:plus": {
		prefix: "fal",
		name: "plus",
		width: 448,
		height: 512,
		d: "M240 64c0-8.8-7.2-16-16-16s-16 7.2-16 16l0 176L32 240c-8.8 0-16 7.2-16 16s7.2 16 16 16l176 0 0 176c0 8.8 7.2 16 16 16s16-7.2 16-16l0-176 176 0c8.8 0 16-7.2 16-16s-7.2-16-16-16l-176 0 0-176z",
	},
	"fal:pencil": {
		prefix: "fal",
		name: "pencil",
		width: 512,
		height: 512,
		d: "M395.8 39.6c9.4-9.4 24.6-9.4 33.9 0l42.6 42.6c9.4 9.4 9.4 24.6 0 33.9L417.6 171 341 94.4l54.8-54.8zM318.4 117L395 193.6l-219 219 0-12.6c0-8.8-7.2-16-16-16l-32 0 0-32c0-8.8-7.2-16-16-16l-12.6 0 219-219zM66.9 379.5c1.2-4 2.7-7.9 4.7-11.5L96 368l0 32c0 8.8 7.2 16 16 16l32 0 0 24.4c-3.7 1.9-7.5 3.5-11.6 4.7L39.6 472.4l27.3-92.8zM452.4 17c-21.9-21.9-57.3-21.9-79.2 0L60.4 329.7c-11.4 11.4-19.7 25.4-24.2 40.8L.7 491.5c-1.7 5.6-.1 11.7 4 15.8s10.2 5.7 15.8 4l121-35.6c15.4-4.5 29.4-12.9 40.8-24.2L495 138.8c21.9-21.9 21.9-57.3 0-79.2L452.4 17zM331.3 202.7c6.2-6.2 6.2-16.4 0-22.6s-16.4-6.2-22.6 0l-128 128c-6.2 6.2-6.2 16.4 0 22.6s16.4 6.2 22.6 0l128-128z",
	},
	"fas:star": {
		prefix: "fas",
		name: "star",
		width: 576,
		height: 512,
		d: "M316.9 18C311.6 7 300.4 0 288.1 0s-23.4 7-28.8 18L195 150.3 51.4 171.5c-12 1.8-22 10.2-25.7 21.7s-.7 24.2 7.9 32.7L137.8 329 113.2 474.7c-2 12 3 24.2 12.9 31.3s23 8 33.8 2.3l128.3-68.5 128.3 68.5c10.8 5.7 23.9 4.9 33.8-2.3s14.9-19.3 12.9-31.3L438.5 329 542.7 225.9c8.6-8.5 11.7-21.2 7.9-32.7s-13.7-19.9-25.7-21.7L381.2 150.3 316.9 18z",
	},
	"fas:magnifying-glass": {
		prefix: "fas",
		name: "magnifying-glass",
		width: 512,
		height: 512,
		d: "M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z",
	},
} as const satisfies Record<string, FaIconDefinition>;

type FaIconKey = keyof typeof FA_ICONS;

type FaIconSize = "1x" | "lg" | "xs" | "sm";

interface FaIconProps {
	icon: FaIconKey;
	size?: FaIconSize;
	className?: string;
	style?: CSSProperties;
}

/** Renders the same svg markup as upstream's @fortawesome/react-fontawesome. */
export function FaIcon({icon, size = "1x", className = "", style}: FaIconProps) {
	const definition: FaIconDefinition = FA_ICONS[icon];
	return (
		<svg
			aria-hidden="true"
			focusable="false"
			data-prefix={definition.prefix}
			data-icon={definition.name}
			className={`svg-inline--fa fa-${definition.name} fa-${size} ${className}`}
			// oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- verbatim upstream FontAwesome markup
			role="img"
			xmlns="http://www.w3.org/2000/svg"
			viewBox={`0 0 ${definition.width} ${definition.height}`}
			style={style}
		>
			<path fill="currentColor" d={definition.d} />
		</svg>
	);
}

export const TRIANGLE_PATH =
	"M13.75 9.56879C14.0833 9.76124 14.0833 10.2424 13.75 10.4348L8.5 13.4659C8.16667 13.6584 7.75 13.4178 7.75 13.0329L7.75 6.97072C7.75 6.58582 8.16667 6.34525 8.5 6.5377L13.75 9.56879Z";

/** Upstream's expand/collapse triangle used by the left bar and node rows. */
export function TriangleSvg({className}: {className?: string}) {
	return (
		<svg width="20" height="20" viewBox="0 0 20 20" className={className}>
			<path d={TRIANGLE_PATH} stroke="none" fill="currentColor" />
		</svg>
	);
}
