import {useOutlineStore} from '../stores/outline.js';

interface ShortcutGroup {
	title: string;
	shortcuts: Array<{keys: string; description: string}>;
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
	{
		title: 'Navigation',
		shortcuts: [
			{keys: '⌘.', description: 'Zoom in'},
			{keys: '⌘,', description: 'Zoom out'},
			{keys: '⌘[', description: 'History back'},
			{keys: '⌘]', description: 'History forward'},
			{keys: "⌘'", description: 'Navigate home'},
			{keys: 'Esc', description: 'Open search'},
			{keys: '^T', description: 'Zoom to Today'},
		],
	},
	{
		title: 'Expand/Collapse',
		shortcuts: [
			{keys: '⌘↓', description: 'Expand'},
			{keys: '⌘↑', description: 'Collapse'},
		],
	},
	{
		title: 'Editing',
		shortcuts: [
			{keys: 'Tab', description: 'Indent'},
			{keys: '⇧Tab', description: 'Outdent'},
			{keys: '⇧⌘↑', description: 'Move up'},
			{keys: '⇧⌘↓', description: 'Move down'},
			{keys: '⇧↵', description: 'Add a note'},
			{keys: '⌘↵', description: 'Complete/uncomplete'},
			{keys: '⇧⌘D', description: 'Duplicate'},
			{keys: '⇧⌘⌫', description: 'Delete'},
		],
	},
	{
		title: 'Sibling Navigation',
		shortcuts: [
			{keys: '⇧⌘9', description: 'Previous sibling'},
			{keys: '⇧⌘0', description: 'Next sibling'},
			{keys: '⌥⌘↑', description: 'Focus previous sibling'},
			{keys: '⌥⌘↓', description: 'Focus next sibling'},
		],
	},
	{
		title: 'Formatting',
		shortcuts: [
			{keys: '⌘B', description: 'Bold'},
			{keys: '⌘I', description: 'Italic'},
			{keys: '⌘U', description: 'Underline'},
			{keys: '⇧⌘X', description: 'Strikethrough'},
			{keys: '⇧⌘C', description: 'Code (inline)'},
			{keys: '⌥⌘6', description: 'Code block'},
			{keys: '⌥⌘7', description: 'Quote'},
		],
	},
	{
		title: 'Node Types',
		shortcuts: [
			{keys: '⌥⌘8', description: 'Bullet'},
			{keys: '⌥⌘9', description: 'To-do'},
			{keys: '⌥⌘1', description: 'Heading 1'},
			{keys: '⌥⌘2', description: 'Heading 2'},
			{keys: '⌥⌘3', description: 'Heading 3'},
			{keys: '⌥⌘4', description: 'Paragraph'},
		],
	},
	{
		title: 'UI Toggles',
		shortcuts: [
			{keys: '^L', description: 'Toggle left sidebar'},
			{keys: '⌘?', description: 'Toggle shortcuts'},
			{keys: '⌘O', description: 'Show/hide completed'},
			{keys: '⇧⌘8', description: 'Star page'},
			{keys: '⌘K', description: 'Jump menu'},
		],
	},
	{
		title: 'Export',
		shortcuts: [{keys: '⇧⌘E', description: 'Export selected node'}],
	},
];

/**
 * Right sidebar component showing keyboard shortcuts help.
 * Toggled open/closed with Cmd+? keyboard shortcut.
 * Styled to match Workflowy's right sidebar layout.
 */
export function RightSidebar() {
	const {rightSidebarOpen, toggleRightSidebar} = useOutlineStore();

	if (!rightSidebarOpen) {
		return null;
	}

	return (
		<aside className="right-sidebar">
			<div className="right-sidebar-header">
				<h2 className="right-sidebar-title">Keyboard Shortcuts</h2>
				<button
					aria-label="Close sidebar"
					className="right-sidebar-close"
					onClick={toggleRightSidebar}
					type="button"
				>
					&times;
				</button>
			</div>

			<div className="right-sidebar-content">
				{SHORTCUT_GROUPS.map((group) => (
					<section
						className="right-sidebar-section"
						key={group.title}
					>
						<h3 className="right-sidebar-section-title">{group.title}</h3>
						<dl className="shortcut-list">
							{group.shortcuts.map((shortcut) => (
								<div
									className="shortcut-item"
									key={shortcut.keys}
								>
									<dt className="shortcut-keys">
										<kbd>{shortcut.keys}</kbd>
									</dt>
									<dd className="shortcut-description">{shortcut.description}</dd>
								</div>
							))}
						</dl>
					</section>
				))}
			</div>

			<div className="right-sidebar-footer">
				<p className="right-sidebar-hint">Press ⌘? to toggle</p>
			</div>
		</aside>
	);
}
