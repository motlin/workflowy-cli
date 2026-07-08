const DURATION_REGEX = /^(\d+)([smhdw])$/;

const UNIT_MS: Record<string, number> = {
	s: 1000,
	m: 60 * 1000,
	h: 60 * 60 * 1000,
	d: 24 * 60 * 60 * 1000,
	w: 7 * 24 * 60 * 60 * 1000,
};

export function parseSince(since: string): Date {
	const match = DURATION_REGEX.exec(since);
	if (match) {
		const value = Number.parseInt(match[1], 10);
		const unit = match[2];
		const ms = value * UNIT_MS[unit];
		return new Date(Date.now() - ms);
	}

	const parsed = new Date(since);
	if (Number.isNaN(parsed.getTime())) {
		throw new TypeError(
			`Invalid --since value: "${since}". Use a duration (1d, 12h, 1w) or an ISO date (2026-02-01).`,
		);
	}
	return parsed;
}
