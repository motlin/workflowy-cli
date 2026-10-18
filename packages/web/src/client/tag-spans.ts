import type {TagColors} from "./hooks/use-tag-colors.js";

// Regex to match #tags and @mentions
// Matches: #tag, #tag-name, #tag_name, @mention, @user-name, @user_name
export const TAG_PATTERN = /[#@][\w-]+/gu;

/**
 * Wrap hashtags and mentions in styled spans for visual highlighting.
 * Uncolored tags are gray underlined links (Cmd+click opens search); tags with
 * an assigned color render as a colored pill (matching production workflowy.com).
 */
export function wrapTagsInSpans(html: string, tagColors: TagColors): string {
	// Reset lastIndex since we're reusing the pattern
	TAG_PATTERN.lastIndex = 0;
	return html.replaceAll(TAG_PATTERN, (match) => {
		const color = tagColors[match];
		const className = color ? `tag-link tag-colored bc-${color}` : "tag-link";
		return `<span class="${className}">${match}</span>`;
	});
}
