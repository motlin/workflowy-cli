export function stripHtmlTags(html: string | null): string {
	if (!html) return '';
	return html
		.replaceAll(/<[^>]*>/g, '')
		.replaceAll('&nbsp;', ' ')
		.replaceAll('&amp;', '&')
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&quot;', '"')
		.trim();
}
