import {useCallback, useEffect, useState} from 'react';
import {stripHtmlTags as stripHtml} from '@workflowy/shared/html';
import {useHotkeys} from 'react-hotkeys-hook';
import {useOutlineStore} from '../stores/outline.js';

type ExportFormat = 'plain-text' | 'markdown' | 'opml';

interface NodeData {
	id: string;
	name: string | null;
	note: string | null;
	children?: NodeData[];
}

function formatPlainText(nodes: NodeData[], depth: number = 0): string {
	const lines: string[] = [];
	const indent = '  '.repeat(depth);

	for (const node of nodes) {
		const name = node.name ? stripHtml(node.name) : '';
		if (name) {
			lines.push(`${indent}- ${name}`);
		}
		if (node.note) {
			const noteText = stripHtml(node.note);
			lines.push(`${indent}  ${noteText}`);
		}
		if (node.children && node.children.length > 0) {
			lines.push(formatPlainText(node.children, depth + 1));
		}
	}

	return lines.join('\n');
}

function formatMarkdown(nodes: NodeData[], depth: number = 0): string {
	const lines: string[] = [];
	const indent = '  '.repeat(depth);

	for (const node of nodes) {
		const name = node.name ? stripHtml(node.name) : '';
		if (name) {
			lines.push(`${indent}- ${name}`);
		}
		if (node.note) {
			const noteText = stripHtml(node.note);
			// Notes are indented and italicized in markdown
			lines.push(`${indent}  *${noteText}*`);
		}
		if (node.children && node.children.length > 0) {
			lines.push(formatMarkdown(node.children, depth + 1));
		}
	}

	return lines.join('\n');
}

function escapeXml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function formatOpmlOutline(nodes: NodeData[], depth: number = 0): string {
	const lines: string[] = [];
	const indent = '\t'.repeat(depth + 2);

	for (const node of nodes) {
		const name = node.name ? escapeXml(stripHtml(node.name)) : '';
		const note = node.note ? escapeXml(stripHtml(node.note)) : '';

		if (node.children && node.children.length > 0) {
			if (note) {
				lines.push(`${indent}<outline text="${name}" _note="${note}">`);
			} else {
				lines.push(`${indent}<outline text="${name}">`);
			}
			lines.push(formatOpmlOutline(node.children, depth + 1), `${indent}</outline>`);
		} else if (note) {
			lines.push(`${indent}<outline text="${name}" _note="${note}" />`);
		} else {
			lines.push(`${indent}<outline text="${name}" />`);
		}
	}

	return lines.join('\n');
}

function formatOpml(nodes: NodeData[], title: string = 'Workflowy Export'): string {
	const now = new Date().toISOString();
	const outlines = formatOpmlOutline(nodes);

	return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
	<head>
		<title>${escapeXml(title)}</title>
		<dateCreated>${now}</dateCreated>
	</head>
	<body>
${outlines}
	</body>
</opml>`;
}

async function fetchNodeTree(nodeId: string): Promise<NodeData | null> {
	const response = await fetch(`/api/v1/nodes/${nodeId}`);
	if (!response.ok) {
		return null;
	}

	const node = (await response.json()) as {id: string; name: string | null; note: string | null};

	// Fetch children
	const childrenResponse = await fetch(`/api/v1/nodes?parent_id=${nodeId}`);
	if (!childrenResponse.ok) {
		return {id: node.id, name: node.name, note: node.note};
	}

	const children = (await childrenResponse.json()) as Array<{id: string; name: string | null; note: string | null}>;

	// Recursively fetch children's trees
	const childTrees = await Promise.all(children.map((child) => fetchNodeTree(child.id)));

	return {
		id: node.id,
		name: node.name,
		note: node.note,
		children: childTrees.filter((c): c is NodeData => c !== null),
	};
}

export function ExportDialog() {
	const exportDialogOpen = useOutlineStore((state) => state.exportDialogOpen);
	const exportContext = useOutlineStore((state) => state.exportContext);
	const closeExportDialog = useOutlineStore((state) => state.closeExportDialog);

	const [format, setFormat] = useState<ExportFormat>('plain-text');
	const [exportContent, setExportContent] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [copied, setCopied] = useState(false);

	// Fetch and format export content when dialog opens or format changes
	useEffect(() => {
		if (!exportDialogOpen || !exportContext || exportContext.nodeIds.length === 0) {
			setExportContent('');
			return;
		}

		let cancelled = false;

		async function loadExportContent() {
			setIsLoading(true);
			try {
				const trees = await Promise.all(exportContext!.nodeIds.map((id) => fetchNodeTree(id)));
				const validTrees = trees.filter((t): t is NodeData => t !== null);

				if (cancelled) {
					return;
				}

				let content: string;
				switch (format) {
					case 'plain-text': {
						content = formatPlainText(validTrees);
						break;
					}
					case 'markdown': {
						content = formatMarkdown(validTrees);
						break;
					}
					case 'opml': {
						content = formatOpml(validTrees);
						break;
					}
				}

				setExportContent(content);
			} catch {
				if (!cancelled) {
					setExportContent('Error loading export content');
				}
			} finally {
				if (!cancelled) {
					setIsLoading(false);
				}
			}
		}

		void loadExportContent();

		return () => {
			cancelled = true;
		};
	}, [exportDialogOpen, exportContext, format]);

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(exportContent);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [exportContent]);

	const handleDownload = useCallback(() => {
		let extension: string;
		let mimeType: string;

		switch (format) {
			case 'plain-text': {
				extension = 'txt';
				mimeType = 'text/plain';
				break;
			}
			case 'markdown': {
				extension = 'md';
				mimeType = 'text/markdown';
				break;
			}
			case 'opml': {
				extension = 'opml';
				mimeType = 'application/xml';
				break;
			}
		}

		const blob = new Blob([exportContent], {type: mimeType});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `workflowy-export.${extension}`;
		document.body.append(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}, [exportContent, format]);

	// Close on Escape
	useHotkeys(
		'escape',
		() => {
			closeExportDialog();
		},
		{
			enabled: exportDialogOpen,
			enableOnFormTags: true,
		},
		[exportDialogOpen, closeExportDialog],
	);

	if (!exportDialogOpen) {
		return null;
	}

	return (
		<div
			className="export-dialog-overlay"
			onClick={closeExportDialog}
		>
			<div
				className="export-dialog"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="export-dialog-header">
					<h2 className="export-dialog-title">Export</h2>
					<button
						className="export-dialog-close"
						onClick={closeExportDialog}
						type="button"
					>
						x
					</button>
				</div>

				<div className="export-dialog-format-row">
					<span className="export-dialog-format-label">Format:</span>
					<div className="export-dialog-format-buttons">
						<button
							className={`export-dialog-format-button ${format === 'plain-text' ? 'selected' : ''}`}
							onClick={() => setFormat('plain-text')}
							type="button"
						>
							Plain Text
						</button>
						<button
							className={`export-dialog-format-button ${format === 'markdown' ? 'selected' : ''}`}
							onClick={() => setFormat('markdown')}
							type="button"
						>
							Markdown
						</button>
						<button
							className={`export-dialog-format-button ${format === 'opml' ? 'selected' : ''}`}
							onClick={() => setFormat('opml')}
							type="button"
						>
							OPML
						</button>
					</div>
				</div>

				<div className="export-dialog-content">
					{isLoading ? (
						<p className="export-dialog-status">Loading...</p>
					) : (
						<textarea
							className="export-dialog-textarea"
							readOnly
							value={exportContent}
						/>
					)}
				</div>

				<div className="export-dialog-footer">
					<button
						className="export-dialog-button export-dialog-copy"
						disabled={isLoading || !exportContent}
						onClick={handleCopy}
						type="button"
					>
						{copied ? 'Copied!' : 'Copy to Clipboard'}
					</button>
					<button
						className="export-dialog-button export-dialog-download"
						disabled={isLoading || !exportContent}
						onClick={handleDownload}
						type="button"
					>
						Download
					</button>
				</div>
			</div>
		</div>
	);
}
