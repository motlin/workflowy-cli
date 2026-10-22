/** The row whose next editing focus leaves the scroll where it is. */
let quietId: string | null = null;

/**
 * Focus `id`'s editor next without scrolling it into view: a row resumed after a navigation swap keeps the scroll the
 * swap set (top, or the position Back/Forward restored), as upstream does, instead of jumping to the row.
 */
export function focusQuietlyNext(id: string): void {
	quietId = id;
}

/** Whether `id`'s editor, focusing now, may scroll itself into view; a quiet focus is used up by the call. */
export function focusScrolls(id: string): boolean {
	if (quietId !== id) {
		return true;
	}
	quietId = null;
	return false;
}
