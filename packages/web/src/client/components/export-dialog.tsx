import {useQuery} from "@tanstack/react-query";
import {useCallback, useMemo, useState} from "react";
import {stripHtmlTags as stripHtml} from "@workflowy/shared/html";
import {useHotkeys} from "react-hotkeys-hook";
import {useOutlineStore} from "../stores/outline.js";
import type {NodeResponse} from "../../node-types.js";
import {readJson} from "../read-json.js";

type ExportFormat = "plain-text" | "markdown" | "opml";

interface NodeData {
	id: string;
	name: string | null;
	note: string | null;
	children?: NodeData[];
}

function formatPlainText(nodes: NodeData[], depth: number = 0): string {
	const lines: string[] = [];
	const indent = "  ".repeat(depth);

	for (const node of nodes) {
		const name = node.name ? stripHtml(node.name) : "";
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

	return lines.join("\n");
}

function formatMarkdown(nodes: NodeData[], depth: number = 0): string {
	const lines: string[] = [];
	const indent = "  ".repeat(depth);

	for (const node of nodes) {
		const name = node.name ? stripHtml(node.name) : "";
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

	return lines.join("\n");
}

function escapeXml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function formatOpmlOutline(nodes: NodeData[], depth: number = 0): string {
	const lines: string[] = [];
	const indent = "\t".repeat(depth + 2);

	for (const node of nodes) {
		const name = node.name ? escapeXml(stripHtml(node.name)) : "";
		const note = node.note ? escapeXml(stripHtml(node.note)) : "";

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

	return lines.join("\n");
}

function formatOpml(nodes: NodeData[], title: string = "Workflowy Export"): string {
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

	const {node} = await readJson<{node: NodeResponse}>(response);

	// Fetch children
	const childrenResponse = await fetch(`/api/v1/nodes?parent_id=${nodeId}`);
	if (!childrenResponse.ok) {
		return {id: node.id, name: node.name, note: node.note};
	}

	const {nodes: children} = await readJson<{nodes: NodeResponse[]}>(childrenResponse);

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

	const [format, setFormat] = useState<ExportFormat>("plain-text");
	const [copied, setCopied] = useState(false);

	const nodeIds = exportContext?.nodeIds ?? [];
	const {
		data: trees,
		isLoading,
		isError,
	} = useQuery({
		queryKey: ["export-trees", nodeIds],
		queryFn: async () => {
			const fetched = await Promise.all(nodeIds.map((id) => fetchNodeTree(id)));
			return fetched.filter((t): t is NodeData => t !== null);
		},
		enabled: exportDialogOpen && nodeIds.length > 0,
		staleTime: 0,
	});

	const exportContent = useMemo(() => {
		if (isError) {
			return "Error loading export content";
		}
		if (!trees) {
			return "";
		}
		switch (format) {
			case "plain-text": {
				return formatPlainText(trees);
			}
			case "markdown": {
				return formatMarkdown(trees);
			}
			case "opml": {
				return formatOpml(trees);
			}
			default: {
				const unknownFormat: never = format;
				throw new Error(`Unknown export format: ${String(unknownFormat)}`);
			}
		}
	}, [format, isError, trees]);

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(exportContent);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [exportContent]);

	const handleDownload = useCallback(() => {
		let extension: string;
		let mimeType: string;

		switch (format) {
			case "plain-text": {
				extension = "txt";
				mimeType = "text/plain";
				break;
			}
			case "markdown": {
				extension = "md";
				mimeType = "text/markdown";
				break;
			}
			case "opml": {
				extension = "opml";
				mimeType = "application/xml";
				break;
			}
		}

		const blob = new Blob([exportContent], {type: mimeType});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `workflowy-export.${extension}`;
		document.body.append(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}, [exportContent, format]);

	// Close on Escape
	useHotkeys(
		"escape",
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
		<div className="export-dialog-overlay" onClick={closeExportDialog}>
			<div className="export-dialog" onClick={(e) => e.stopPropagation()}>
				<div className="export-dialog-header">
					<h2 className="export-dialog-title">Export</h2>
					<button className="export-dialog-close" onClick={closeExportDialog} type="button">
						x
					</button>
				</div>

				<div className="export-dialog-format-row">
					<span className="export-dialog-format-label">Format:</span>
					<div className="export-dialog-format-buttons">
						<button
							className={`export-dialog-format-button ${format === "plain-text" ? "selected" : ""}`}
							onClick={() => setFormat("plain-text")}
							type="button"
						>
							Plain Text
						</button>
						<button
							className={`export-dialog-format-button ${format === "markdown" ? "selected" : ""}`}
							onClick={() => setFormat("markdown")}
							type="button"
						>
							Markdown
						</button>
						<button
							className={`export-dialog-format-button ${format === "opml" ? "selected" : ""}`}
							onClick={() => setFormat("opml")}
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
						<textarea className="export-dialog-textarea" readOnly value={exportContent} />
					)}
				</div>

				<div className="export-dialog-footer">
					<button
						className="export-dialog-button export-dialog-copy"
						disabled={isLoading || !exportContent}
						onClick={handleCopy}
						type="button"
					>
						{copied ? "Copied!" : "Copy to Clipboard"}
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
