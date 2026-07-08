import type {Meta, StoryObj} from '@storybook/react-vite';

import {StaticNode} from './primitives.js';

const meta: Meta = {
	title: 'Compositions/TreeView',
	parameters: {
		layout: 'padded',
	},
	decorators: [
		(Story) => (
			<div
				className="outline-view"
				style={{width: '700px', position: 'relative'}}
			>
				<Story />
			</div>
		),
	],
};

export default meta;
type Story = StoryObj;

export const MultipleNestingLevels: Story = {
	render: () => (
		<>
			<StaticNode
				depth={0}
				isExpanded
				name="Root level item"
			/>
			<StaticNode
				depth={1}
				isExpanded
				name="First child"
			/>
			<StaticNode
				depth={2}
				isExpanded
				name="Grandchild item"
			/>
			<StaticNode
				depth={3}
				name="Great-grandchild"
			/>
			<StaticNode
				depth={3}
				name="Another great-grandchild"
			/>
			<StaticNode
				depth={2}
				name="Second grandchild"
			/>
			<StaticNode
				depth={1}
				isExpanded
				name="Second child"
			/>
			<StaticNode
				depth={2}
				name="Nested under second child"
			/>
			<StaticNode
				depth={0}
				name="Another root item"
			/>
		</>
	),
};

export const MixedCompletedUncompleted: Story = {
	render: () => (
		<>
			<StaticNode
				depth={0}
				isExpanded
				name="Project Tasks"
			/>
			<StaticNode
				depth={1}
				isCompleted
				name="Design mockups"
			/>
			<StaticNode
				depth={1}
				isCompleted
				name="Set up development environment"
			/>
			<StaticNode
				depth={1}
				name="Implement core features"
			/>
			<StaticNode
				depth={1}
				name="Write unit tests"
			/>
			<StaticNode
				depth={1}
				isCompleted
				name="Code review"
			/>
			<StaticNode
				depth={1}
				name="Deploy to staging"
			/>
			<StaticNode
				depth={1}
				name="User acceptance testing"
			/>
		</>
	),
};

export const NodesWithAndWithoutNotes: Story = {
	render: () => (
		<>
			<StaticNode
				depth={0}
				isExpanded
				name="Meeting Notes"
				note="Weekly sync with the team"
			/>
			<StaticNode
				depth={1}
				name="Discuss roadmap"
				note="Q1 priorities: performance, new features, bug fixes"
			/>
			<StaticNode
				depth={1}
				name="Review metrics"
			/>
			<StaticNode
				depth={1}
				name="Team updates"
				note="Each team member shares their progress and blockers"
			/>
			<StaticNode
				depth={1}
				name="Action items"
			/>
			<StaticNode
				depth={0}
				isExpanded
				name="Ideas"
			/>
			<StaticNode
				depth={1}
				name="New feature concept"
				note="Allow users to collaborate in real-time. Need to research WebSocket implementation and consider scaling implications."
			/>
			<StaticNode
				depth={1}
				name="Performance optimization"
			/>
		</>
	),
};

export const ComplexTree: Story = {
	render: () => (
		<>
			<StaticNode
				depth={0}
				isExpanded
				name='<span class="colored c-green">Work</span>'
			/>
			<StaticNode
				depth={1}
				isExpanded
				name="Current Sprint"
				note="Sprint 42: Focus on user experience improvements"
			/>
			<StaticNode
				depth={2}
				isCompleted
				name="Fix navigation bug"
			/>
			<StaticNode
				depth={2}
				isSelected
				name="Implement search feature"
				note="Use fuzzy matching for better results"
			/>
			<StaticNode
				depth={2}
				name="Update documentation"
			/>
			<StaticNode
				depth={1}
				name="Backlog"
			/>
			<StaticNode
				depth={0}
				isExpanded
				name='<span class="colored c-blue">Personal</span>'
			/>
			<StaticNode
				depth={1}
				isCompleted
				name="Morning routine"
			/>
			<StaticNode
				depth={1}
				name="Read book"
				note="Currently reading: System Design Interview"
			/>
			<StaticNode
				depth={1}
				isExpanded
				name="Groceries"
			/>
			<StaticNode
				depth={2}
				isCompleted
				name="Milk"
			/>
			<StaticNode
				depth={2}
				isCompleted
				name="Bread"
			/>
			<StaticNode
				depth={2}
				name="Vegetables"
			/>
		</>
	),
};

export const DeepNesting: Story = {
	render: () => (
		<>
			<StaticNode
				depth={0}
				isExpanded
				name="Level 0"
			/>
			<StaticNode
				depth={1}
				isExpanded
				name="Level 1"
			/>
			<StaticNode
				depth={2}
				isExpanded
				name="Level 2"
			/>
			<StaticNode
				depth={3}
				isExpanded
				name="Level 3"
			/>
			<StaticNode
				depth={4}
				isExpanded
				name="Level 4"
			/>
			<StaticNode
				depth={5}
				isExpanded
				name="Level 5"
			/>
			<StaticNode
				depth={6}
				name="Level 6 (leaf)"
			/>
		</>
	),
};
