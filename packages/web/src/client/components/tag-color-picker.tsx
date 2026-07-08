import {createPortal} from 'react-dom';

/**
 * Floating color picker for assigning a color to a tag (#tag / @mention),
 * modeled on Workflowy's selection color widget: a leading "remove color"
 * swatch (diagonal red line) followed by a pastel "A" swatch per color.
 *
 * Tag colors are our own feature (Workflowy has no API for them) and apply
 * globally to every instance of the tag. Rendered via a portal to document.body
 * so its fixed positioning is relative to the viewport, not the transformed
 * (virtualized) outline rows.
 */

// Workflowy's tag color palette, in the same order as its picker.
const TAG_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'sky', 'blue', 'purple', 'pink', 'gray'] as const;

export type TagColorName = (typeof TAG_COLORS)[number];

interface TagColorPickerProps {
	top: number;
	left: number;
	currentColor?: string;
	onSelect: (color: TagColorName) => void;
	onRemove: () => void;
}

export function TagColorPicker({top, left, currentColor, onSelect, onRemove}: TagColorPickerProps) {
	return createPortal(
		<div
			className="tag-color-picker"
			// Keep the editor's selection/focus when interacting with the picker.
			onMouseDown={(event) => event.preventDefault()}
			style={{top: `${top}px`, left: `${left}px`}}
		>
			<button
				aria-label="Remove color"
				className={`tag-color-swatch tag-color-remove${currentColor ? '' : ' selected'}`}
				onClick={onRemove}
				title="Remove color"
				type="button"
			>
				<svg
					aria-hidden="true"
					viewBox="0 0 100 100"
				>
					<line
						stroke="#EB5757"
						strokeWidth="8"
						x1="0"
						x2="100"
						y1="100"
						y2="0"
					/>
				</svg>
			</button>
			{TAG_COLORS.map((color) => (
				<button
					aria-label={color}
					className={`tag-color-swatch bc-${color}${currentColor === color ? ' selected' : ''}`}
					key={color}
					onClick={() => onSelect(color)}
					title={color[0].toUpperCase() + color.slice(1)}
					type="button"
				>
					A
				</button>
			))}
		</div>,
		document.body,
	);
}
