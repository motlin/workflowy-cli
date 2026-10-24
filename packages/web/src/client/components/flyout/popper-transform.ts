/** Popper's `computeStyles` transform: offsets rounded to device pixels, `translate` at dpr <= 1, else `translate3d`. */
export function popperTransform(x: number, y: number, dpr: number): string {
	const roundedX = Math.round(x * dpr) / dpr;
	const roundedY = Math.round(y * dpr) / dpr;
	return dpr <= 1 ? `translate(${roundedX}px, ${roundedY}px)` : `translate3d(${roundedX}px, ${roundedY}px, 0px)`;
}
