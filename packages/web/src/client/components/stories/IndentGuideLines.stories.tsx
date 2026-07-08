import type {Meta, StoryObj} from '@storybook/react-vite';

import {IndentGuideLines} from './primitives.js';

const meta: Meta<typeof IndentGuideLines> = {
	title: 'Primitives/IndentGuideLines',
	component: IndentGuideLines,
	parameters: {
		layout: 'padded',
	},
	tags: ['autodocs'],
	argTypes: {
		depth: {
			control: {type: 'number', min: 0, max: 10},
			description: 'Nesting depth (number of vertical lines)',
		},
	},
	decorators: [
		(Story) => (
			<div style={{position: 'relative', height: '100px', width: '400px'}}>
				<Story />
			</div>
		),
	],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const NoIndent: Story = {
	args: {
		depth: 0,
	},
};

export const OneLevel: Story = {
	args: {
		depth: 1,
	},
};

export const TwoLevels: Story = {
	args: {
		depth: 2,
	},
};

export const ThreeLevels: Story = {
	args: {
		depth: 3,
	},
};

export const DeepNesting: Story = {
	args: {
		depth: 5,
	},
};
