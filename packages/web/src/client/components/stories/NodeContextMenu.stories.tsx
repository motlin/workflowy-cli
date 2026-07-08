import type {Meta, StoryObj} from '@storybook/react-vite';

import {MenuItem} from './primitives.js';

/**
 * The full context menu rendered inline (without portal) for Storybook.
 * Shows all menu sections including timestamps.
 */
function ContextMenuInline({
	isCompleted = false,
	createdAt = 'Dec 1, 2024, 10:30 AM',
	modifiedAt = 'Dec 15, 2024, 2:45 PM',
}: {
	isCompleted?: boolean;
	createdAt?: string;
	modifiedAt?: string;
}) {
	return (
		<div
			className="node-context-menu"
			style={{position: 'relative', top: 'auto', left: 'auto'}}
		>
			<div className="node-context-menu-section">
				<MenuItem
					disabled
					label="Turn into"
				/>
				<MenuItem label={isCompleted ? 'Uncomplete' : 'Complete'} />
				<MenuItem
					disabled
					label="Add note"
				/>
				<MenuItem
					disabled
					label="Add date"
				/>
			</div>

			<div className="node-context-menu-divider" />

			<div className="node-context-menu-section">
				<MenuItem
					disabled
					label="Present"
				/>
				<MenuItem
					disabled
					label="Add comment"
				/>
			</div>

			<div className="node-context-menu-divider" />

			<div className="node-context-menu-section">
				<MenuItem
					disabled
					label="Move To"
				/>
				<MenuItem
					disabled
					label="Upload file"
				/>
				<MenuItem
					disabled
					label="Mirror To"
				/>
				<MenuItem
					disabled
					label="Mirror"
				/>
				<MenuItem
					disabled
					label="Duplicate"
				/>
			</div>

			<div className="node-context-menu-divider" />

			<div className="node-context-menu-section">
				<MenuItem
					disabled
					label="Share"
				/>
				<MenuItem
					disabled
					label="Export"
				/>
				<MenuItem
					disabled
					label="Copy internal link"
				/>
				<MenuItem
					disabled
					label="Make template"
				/>
			</div>

			<div className="node-context-menu-divider" />

			<div className="node-context-menu-section">
				<MenuItem
					danger
					label="Delete"
				/>
			</div>

			<div className="node-context-menu-divider" />

			<div className="node-context-menu-section">
				<MenuItem label="Expand all" />
				<MenuItem label="Collapse all" />
			</div>

			<div className="node-context-menu-divider" />

			<div className="node-context-menu-section">
				<MenuItem
					disabled
					label="Sort A-Z"
				/>
				<MenuItem
					disabled
					label="Sort Z-A"
				/>
			</div>

			<div className="node-context-menu-divider" />

			<div className="node-context-menu-timestamps">
				<div className="node-context-menu-timestamp">
					<span className="node-context-menu-timestamp-label">Changed:</span>
					<span className="node-context-menu-timestamp-value">{modifiedAt}</span>
				</div>
				<div className="node-context-menu-timestamp">
					<span className="node-context-menu-timestamp-label">Created:</span>
					<span className="node-context-menu-timestamp-value">{createdAt}</span>
				</div>
			</div>
		</div>
	);
}

const meta: Meta<typeof ContextMenuInline> = {
	title: 'Components/NodeContextMenu',
	component: ContextMenuInline,
	parameters: {
		layout: 'centered',
	},
	tags: ['autodocs'],
	argTypes: {
		isCompleted: {
			control: 'boolean',
			description: 'Whether the node is completed (changes Complete/Uncomplete label)',
		},
		createdAt: {
			control: 'text',
			description: 'Created timestamp display',
		},
		modifiedAt: {
			control: 'text',
			description: 'Modified timestamp display',
		},
	},
	args: {},
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		isCompleted: false,
		createdAt: 'Dec 1, 2024, 10:30 AM',
		modifiedAt: 'Dec 15, 2024, 2:45 PM',
	},
};

export const CompletedNode: Story = {
	args: {
		isCompleted: true,
		createdAt: 'Nov 15, 2024, 9:00 AM',
		modifiedAt: 'Dec 10, 2024, 4:30 PM',
	},
};
