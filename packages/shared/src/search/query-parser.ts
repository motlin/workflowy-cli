/**
 * Structured form of a search query after operators are parsed out.
 */
export interface ParsedQuery {
	/** Quoted `"exact phrases"`, each of which must appear in name or note. */
	exactPhrases: string[];
	/** Bare terms combined with AND (all must appear). */
	requiredTerms: string[];
	/** `a OR b` groups; at least one group must match, all terms within a group must match. */
	orTerms: string[][];
	/** `-term` negations; none may appear. */
	excludedTerms: string[];
	/** `is:complete` → true, `is:incomplete` → false, absent → null. */
	isComplete: boolean | null;
	/** `last-changed:Nd` → N, absent → null. */
	lastChangedDays: number | null;
}

/**
 * Parse a search query string into its structured operators.
 *
 * Supports quoted `"exact phrases"`, `is:complete` / `is:incomplete`,
 * `last-changed:Nd`, `-negation`, `a OR b` groups, and bare AND terms. Pure and
 * side-effect free so it can be unit-tested and reused by any adapter.
 */
export function parseSearchQuery(queryString: string): ParsedQuery {
	const result: ParsedQuery = {
		exactPhrases: [],
		requiredTerms: [],
		orTerms: [],
		excludedTerms: [],
		isComplete: null,
		lastChangedDays: null,
	};

	let remaining = queryString.trim();

	// Extract exact phrases (quoted strings)
	const exactPhraseRegex = /"([^"]+)"/g;
	let match;
	while ((match = exactPhraseRegex.exec(remaining)) !== null) {
		result.exactPhrases.push(match[1]);
	}
	remaining = remaining.replaceAll(exactPhraseRegex, ' ');

	// Extract completion filter: is:complete or is:incomplete
	const completeMatch = /\bis:complete\b/i.exec(remaining);
	if (completeMatch) {
		result.isComplete = true;
		remaining = remaining.replace(completeMatch[0], ' ');
	}
	const incompleteMatch = /\bis:incomplete\b/i.exec(remaining);
	if (incompleteMatch) {
		result.isComplete = false;
		remaining = remaining.replace(incompleteMatch[0], ' ');
	}

	// Extract date filter: last-changed:7d
	const dateMatch = /\blast-changed:(\d+)d\b/i.exec(remaining);
	if (dateMatch) {
		result.lastChangedDays = Number.parseInt(dateMatch[1], 10);
		remaining = remaining.replace(dateMatch[0], ' ');
	}

	// Extract negated terms: -word
	const negationRegex = /-(\S+)/g;
	while ((match = negationRegex.exec(remaining)) !== null) {
		result.excludedTerms.push(match[1]);
	}
	remaining = remaining.replaceAll(negationRegex, ' ');

	// Process remaining terms for OR groups and required terms
	// Split by OR (case-insensitive) to find OR groups
	const orSplit = remaining.split(/\s+OR\s+/);
	if (orSplit.length > 1) {
		// Multiple parts separated by OR
		for (const part of orSplit) {
			const terms = part
				.trim()
				.split(/\s+/)
				.filter((term) => term.length > 0);
			if (terms.length > 0) {
				result.orTerms.push(terms);
			}
		}
	} else {
		// No OR operators, all terms are AND (required)
		const terms = remaining
			.trim()
			.split(/\s+/)
			.filter((term) => term.length > 0);
		result.requiredTerms = terms;
	}

	return result;
}
