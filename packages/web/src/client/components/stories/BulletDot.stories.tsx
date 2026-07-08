import type {Meta, StoryObj} from '@storybook/react-vite';

import {BulletDot} from './primitives.js';

const meta: Meta<typeof BulletDot> = {
	title: 'Primitives/BulletDot',
	component: BulletDot,
	parameters: {
		layout: 'centered',
	},
	tags: ['autodocs'],
	argTypes: {
		isCompleted: {
			control: 'boolean',
			description: 'Whether the node is completed',
		},
		isDragging: {
			control: 'boolean',
			description: 'Whether the bullet is being dragged',
		},
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {},
};

export const Completed: Story = {
	args: {
		isCompleted: true,
	},
};

export const Dragging: Story = {
	args: {
		isDragging: true,
	},
};
