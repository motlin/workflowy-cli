/**
 * The tag color palette, shared by the server-side validator (`tags` route) and
 * the client-side picker. The matching CSS classes live in `styles.css`.
 */
export const TAG_COLORS = [
	'red',
	'orange',
	'yellow',
	'green',
	'teal',
	'sky',
	'blue',
	'purple',
	'pink',
	'gray',
] as const;

export type TagColorName = (typeof TAG_COLORS)[number];
