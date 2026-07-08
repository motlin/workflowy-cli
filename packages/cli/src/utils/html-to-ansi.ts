import chalk from 'chalk';
import {type HTMLElement, type Node, NodeType, parse} from 'node-html-parser';

type ChalkColor = (text: string) => string;

/**
 * Mapping of Workflowy color classes to chalk styles.
 * Workflowy uses:
 * - c-{color} for foreground/text color
 * - bc-{color} for background color
 */
const FOREGROUND_COLORS: Record<string, ChalkColor> = {
	'c-red': chalk.red,
	'c-orange': chalk.hex('#FF8C00'),
	'c-yellow': chalk.yellow,
	'c-green': chalk.green,
	'c-blue': chalk.blue,
	'c-purple': chalk.magenta,
	'c-pink': chalk.hex('#FF69B4'),
	'c-sky': chalk.cyan,
	'c-teal': chalk.hex('#008080'),
	'c-gray': chalk.gray,
	'c-grey': chalk.gray,
};

const BACKGROUND_COLORS: Record<string, ChalkColor> = {
	'bc-red': chalk.bgRed,
	'bc-orange': chalk.bgHex('#FF8C00'),
	'bc-yellow': chalk.bgYellow,
	'bc-green': chalk.bgGreen,
	'bc-blue': chalk.bgBlue,
	'bc-purple': chalk.bgMagenta,
	'bc-pink': chalk.bgHex('#FF69B4'),
	'bc-sky': chalk.bgCyan,
	'bc-teal': chalk.bgHex('#008080'),
	'bc-gray': chalk.bgGray,
	'bc-grey': chalk.bgGray,
};

/**
 * Convert Workflowy HTML to ANSI-styled terminal text.
 *
 * Supports:
 * - <span class="colored c-{color}">text</span> (foreground colors)
 * - <span class="colored bc-{color}">text</span> (background colors)
 * - <b> and <strong> (bold)
 * - <i> and <em> (italic)
 * - <u> (underline)
 * - <a href="...">text</a> (links shown as underlined with URL in grey)
 * - Plain text and nested elements
 */
export function htmlToAnsi(html: string): string {
	if (!html || !html.includes('<')) {
		return html;
	}

	const root = parse(html, {
		lowerCaseTagName: true,
		comment: false,
	});

	return processNode(root);
}

function processNode(node: Node): string {
	if (node.nodeType === NodeType.TEXT_NODE) {
		return node.rawText;
	}

	if (node.nodeType !== NodeType.ELEMENT_NODE) {
		return '';
	}

	const element = node as HTMLElement;
	const tagName = element.tagName?.toLowerCase();
	const childText = element.childNodes.map((child) => processNode(child)).join('');

	switch (tagName) {
		case 'b':
		case 'strong': {
			return chalk.bold(childText);
		}

		case 'i':
		case 'em': {
			return chalk.italic(childText);
		}

		case 'u': {
			return chalk.underline(childText);
		}

		case 's':
		case 'strike':
		case 'del': {
			return chalk.strikethrough(childText);
		}

		case 'a': {
			const href = element.getAttribute('href');
			if (href) {
				return `${chalk.underline(childText)} ${chalk.gray(`(${href})`)}`;
			}
			return chalk.underline(childText);
		}

		case 'span': {
			return processSpan(element, childText);
		}

		case 'br': {
			return '\n';
		}

		default: {
			return childText;
		}
	}
}

function processSpan(element: HTMLElement, childText: string): string {
	const className = element.getAttribute('class') ?? '';
	const classes = className.split(/\s+/);

	let styledText = childText;
	let hasStyle = false;

	for (const cls of classes) {
		if (FOREGROUND_COLORS[cls]) {
			styledText = FOREGROUND_COLORS[cls](styledText);
			hasStyle = true;
		} else if (BACKGROUND_COLORS[cls]) {
			styledText = BACKGROUND_COLORS[cls](styledText);
			hasStyle = true;
		}
	}

	return hasStyle ? styledText : childText;
}
