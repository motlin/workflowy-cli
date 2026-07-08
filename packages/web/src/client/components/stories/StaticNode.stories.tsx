import type {Meta, StoryObj} from '@storybook/react-vite';
import {fn} from 'storybook/test';

import {StaticNode} from './primitives.js';

const meta: Meta<typeof StaticNode> = {
	title: 'Components/StaticNode',
	component: StaticNode,
	parameters: {
		layout: 'padded',
	},
	tags: ['autodocs'],
	argTypes: {
		name: {
			control: 'text',
			description: 'The node text content (can include HTML)',
		},
		note: {
			control: 'text',
			description: 'Optional note content',
		},
		isCompleted: {
			control: 'boolean',
			description: 'Whether the node is completed (strikethrough)',
		},
		isExpanded: {
			control: 'boolean',
			description: 'Whether the node is expanded',
		},
		isSelected: {
			control: 'boolean',
			description: 'Whether the node is selected',
		},
		depth: {
			control: {type: 'number', min: 0, max: 10},
			description: 'Nesting depth',
		},
	},
	args: {
		onToggleExpand: fn(),
	},
	decorators: [
		(Story) => (
			<div style={{width: '600px', position: 'relative', minHeight: '50px'}}>
				<Story />
			</div>
		),
	],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const LeafNode: Story = {
	args: {
		name: 'A leaf node without children',
		isExpanded: false,
		isCompleted: false,
		depth: 0,
	},
};

export const ExpandedNode: Story = {
	args: {
		name: 'An expanded node with children',
		isExpanded: true,
		isCompleted: false,
		depth: 0,
	},
};

export const CompletedNode: Story = {
	args: {
		name: 'A completed task',
		isExpanded: false,
		isCompleted: true,
		depth: 0,
	},
};

export const SelectedNode: Story = {
	args: {
		name: 'A selected node',
		isExpanded: false,
		isCompleted: false,
		isSelected: true,
		depth: 0,
	},
};

export const NodeWithNote: Story = {
	args: {
		name: 'Node with a note',
		note: 'This is additional information about the node.',
		isExpanded: false,
		isCompleted: false,
		depth: 0,
	},
};

export const NodeWithLongNote: Story = {
	args: {
		name: 'Node with a long note',
		note: 'This is a much longer note that contains multiple sentences. It provides detailed context about the node, including background information, related links, and additional considerations that might be relevant when working on this item.',
		isExpanded: false,
		isCompleted: false,
		depth: 0,
	},
};

export const NestedNode: Story = {
	args: {
		name: 'A nested child node',
		isExpanded: false,
		isCompleted: false,
		depth: 2,
	},
};

export const WithHTMLContent: Story = {
	args: {
		name: '<span class="colored c-green">Green text</span> with <b>bold</b> and <em>italic</em>',
		isExpanded: false,
		isCompleted: false,
		depth: 0,
	},
};

export const CompletedWithNote: Story = {
	args: {
		name: 'Completed task with notes',
		note: 'This task was completed on time.',
		isExpanded: false,
		isCompleted: true,
		depth: 0,
	},
};
