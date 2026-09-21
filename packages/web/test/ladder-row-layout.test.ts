import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../src/client/ladder.css', import.meta.url)), 'utf8');
const tsx = readFileSync(fileURLToPath(new URL('../src/client/components/ladder-view.tsx', import.meta.url)), 'utf8');

function rowTracks(): string[] {
	const rule = /\.ladder-row \{([^}]*)\}/.exec(css);
	if (!rule) throw new Error('no .ladder-row rule');
	const declaration = /grid-template-columns:\s*([^;]+);/.exec(rule[1]);
	if (!declaration) throw new Error('no grid-template-columns on .ladder-row');
	// Split on spaces that are not inside minmax(...).
	return declaration[1].trim().split(/\s+(?![^(]*\))/);
}

describe('ladder row layout', () => {
	// Fewer tracks than children wraps the last child (Done) onto a second grid row, doubling
	// every row's height, and slides the 1fr track off the text onto the rank number.
	it('gives every row child its own column so nothing wraps to a second line', () => {
		const children = ['grip', 'rank', 'txt', 'step', 'done'];
		expect(rowTracks()).toHaveLength(children.length);
	});

	it('spends the flexible column on the task text, not the rank', () => {
		const tracks = rowTracks();
		const flexible = tracks.findIndex((track) => track.includes('1fr'));
		expect(flexible).toBe(2);
	});

	it('renders the row children in the order the columns assume', () => {
		const row = /className=\{\[\s*'ladder-row'[\s\S]*?\n\t\t\t\t\t<\/div>/.exec(tsx);
		expect(row).not.toBeNull();
		const order = [...row![0].matchAll(/className="(grip|rank|txt|step|done)"/g)].map((match) => match[1]);
		expect(order).toStrictEqual(['grip', 'rank', 'txt', 'step', 'done']);
	});
});
