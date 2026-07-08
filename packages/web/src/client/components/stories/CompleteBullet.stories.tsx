import type {Meta, StoryObj} from '@storybook/react-vite';
import {fn} from 'storybook/test';

import {CompleteBullet} from './primitives.js';

const meta: Meta<typeof CompleteBullet> = {
	title: 'Primitives/CompleteBullet',
	component: CompleteBullet,
	parameters: {
		layout: 'padded',
	},
	tags: ['autodocs'],
	argTypes: {
		isExpanded: {
			control: 'boolean',
			description: 'Whether the node is expanded',
		},
		isCompleted: {
			control: 'boolean',
			description: 'Whether the node is completed',
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
			<div style={{position: 'relative', minHeight: '50px', width: '400px'}}>
				<Story />
			</div>
		),
	],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		isExpanded: false,
		isCompleted: false,
		depth: 0,
	},
};

export const Expanded: Story = {
	args: {
		isExpanded: true,
		isCompleted: false,
		depth: 0,
	},
};

export const Completed: Story = {
	args: {
		isExpanded: false,
		isCompleted: true,
		depth: 0,
	},
};

export const NestedOneLevel: Story = {
	args: {
		isExpanded: false,
		isCompleted: false,
		depth: 1,
	},
};

export const NestedTwoLevels: Story = {
	args: {
		isExpanded: true,
		isCompleted: false,
		depth: 2,
	},
};

export const DeepNested: Story = {
	args: {
		isExpanded: false,
		isCompleted: false,
		depth: 4,
	},
};
