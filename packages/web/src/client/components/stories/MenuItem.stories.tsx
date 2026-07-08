import type {Meta, StoryObj} from '@storybook/react-vite';
import {fn} from 'storybook/test';

import {MenuItem} from './primitives.js';

const meta: Meta<typeof MenuItem> = {
	title: 'Components/MenuItem',
	component: MenuItem,
	parameters: {
		layout: 'centered',
	},
	tags: ['autodocs'],
	argTypes: {
		label: {
			control: 'text',
			description: 'The text label for the menu item',
		},
		disabled: {
			control: 'boolean',
			description: 'Whether the menu item is disabled',
		},
		danger: {
			control: 'boolean',
			description: 'Whether this is a destructive action (red styling)',
		},
	},
	args: {
		onClick: fn(),
	},
	decorators: [
		(Story) => (
			<div
				style={{
					backgroundColor: 'var(--color-bg)',
					border: '1px solid var(--color-border)',
					borderRadius: '6px',
					padding: '4px 0',
					minWidth: '160px',
				}}
			>
				<Story />
			</div>
		),
	],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		label: 'Complete',
	},
};

export const Disabled: Story = {
	args: {
		label: 'Turn into',
		disabled: true,
	},
};

export const Danger: Story = {
	args: {
		label: 'Delete',
		danger: true,
	},
};

export const AllVariants: Story = {
	render: () => (
		<>
			<MenuItem label="Complete" />
			<MenuItem
				disabled
				label="Add note"
			/>
			<MenuItem
				disabled
				label="Add date"
			/>
			<div
				style={{
					height: '1px',
					backgroundColor: 'var(--color-border)',
					margin: '4px 0',
				}}
			/>
			<MenuItem label="Expand all" />
			<MenuItem label="Collapse all" />
			<div
				style={{
					height: '1px',
					backgroundColor: 'var(--color-border)',
					margin: '4px 0',
				}}
			/>
			<MenuItem
				danger
				label="Delete"
			/>
		</>
	),
};
