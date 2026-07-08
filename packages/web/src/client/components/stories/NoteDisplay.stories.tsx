import type {Meta, StoryObj} from '@storybook/react-vite';
import {fn} from 'storybook/test';

import {NoteDisplay} from './primitives.js';

const meta: Meta<typeof NoteDisplay> = {
	title: 'Components/NoteDisplay',
	component: NoteDisplay,
	parameters: {
		layout: 'padded',
	},
	tags: ['autodocs'],
	argTypes: {
		content: {
			control: 'text',
			description: 'HTML content of the note',
		},
		isExpanded: {
			control: 'boolean',
			description: 'Whether the note is expanded to show full content',
		},
	},
	args: {
		onToggle: fn(),
	},
	decorators: [
		(Story) => (
			<div style={{width: '400px'}}>
				<Story />
			</div>
		),
	],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const CollapsedShort: Story = {
	args: {
		content: 'A brief note about this item.',
		isExpanded: false,
	},
};

export const CollapsedLong: Story = {
	args: {
		content:
			'This is a much longer note that contains multiple lines of text. It demonstrates how notes are truncated when collapsed. The note continues with more details about the item, including background information, context, and additional considerations that might be relevant.',
		isExpanded: false,
	},
};

export const ExpandedShort: Story = {
	args: {
		content: 'A brief note about this item.',
		isExpanded: true,
	},
};

export const ExpandedLong: Story = {
	args: {
		content:
			'This is a much longer note that contains multiple lines of text. It demonstrates how notes are truncated when collapsed. The note continues with more details about the item, including background information, context, and additional considerations that might be relevant.',
		isExpanded: true,
	},
};

export const WithHTML: Story = {
	args: {
		content: '<b>Important:</b> This note contains <em>formatted text</em> and a <a href="#">link</a>.',
		isExpanded: true,
	},
};

export const WithLineBreaks: Story = {
	args: {
		content: 'First line of the note.<br/>Second line with more details.<br/>Third line concluding the thought.',
		isExpanded: true,
	},
};

export const Empty: Story = {
	args: {
		content: '',
		isExpanded: false,
	},
};
