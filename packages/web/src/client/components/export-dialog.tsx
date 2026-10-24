import {useQuery} from "@tanstack/react-query";
import {useCallback, useMemo, useState} from "react";
import {useHotkeys} from "react-hotkeys-hook";
import {useOutlineStore} from "../stores/outline.js";
import type {NodeResponse} from "../../node-types.js";
import {formatToString, linkParents} from "../export-format.js";
import type {ExportItem} from "../export-format.js";
import {readJson} from "../read-json.js";

type ExportFormat = "plain-text" | "markdown" | "opml";

const FORMATTER_TYPE = {"plain-text": "text", markdown: "markdown", opml: "opml"} as const;

async function fetchNodeTree(nodeId: string): Promise<ExportItem | null> {
	const response = await fetch(`/api/v1/nodes/${nodeId}`);
	if (!response.ok) {
		return null;
	}

	const {node} = await readJson<{node: NodeResponse}>(response);
	const item: ExportItem = {
		id: node.id,
		name: node.name ?? "",
		note: node.note ?? "",
		layoutMode: node.data.layoutMode,
		numberedStart: node.numberedStart ?? null,
		completed: node.completedAt !== null,
		parent: null,
		children: [],
	};

	// Fetch children
	const childrenResponse = await fetch(`/api/v1/nodes?parent_id=${nodeId}`);
	if (!childrenResponse.ok) {
		return item;
	}

	const {nodes: children} = await readJson<{nodes: NodeResponse[]}>(childrenResponse);

	// Recursively fetch children's trees
	const childTrees = await Promise.all(children.map(async (child) => fetchNodeTree(child.id)));
	item.children = childTrees.filter((c): c is ExportItem => c !== null);
	return item;
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
			const fetched = await Promise.all(nodeIds.map(async (id) => fetchNodeTree(id)));
			return linkParents(fetched.filter((t): t is ExportItem => t !== null));
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
		return formatToString(FORMATTER_TYPE[format], trees);
	}, [format, isError, trees]);

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(exportContent);
		setCopied(true);
		setTimeout(() => {
			setCopied(false);
		}, 2000);
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
		<div
			className="export-dialog-overlay"
			onClick={(event) => {
				if (event.target === event.currentTarget) {
					closeExportDialog();
				}
			}}
			role="presentation"
		>
			<div className="export-dialog">
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
							onClick={() => {
								setFormat("plain-text");
							}}
							type="button"
						>
							Plain Text
						</button>
						<button
							className={`export-dialog-format-button ${format === "markdown" ? "selected" : ""}`}
							onClick={() => {
								setFormat("markdown");
							}}
							type="button"
						>
							Markdown
						</button>
						<button
							className={`export-dialog-format-button ${format === "opml" ? "selected" : ""}`}
							onClick={() => {
								setFormat("opml");
							}}
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
							name="export-content"
							readOnly
							value={exportContent}
						/>
					)}
				</div>

				<div className="export-dialog-footer">
					<button
						className="export-dialog-button export-dialog-copy"
						disabled={isLoading || !exportContent}
						onClick={() => {
							void handleCopy();
						}}
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
