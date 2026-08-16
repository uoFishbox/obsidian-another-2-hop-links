import { App, Notice, TFile } from "obsidian";
import { resolveFileByPath } from "shared/obsidian/resolveFileByPath";
import type { TwoHopLinkResult } from "types/domain";
import { resolveWorkspaceDocument } from "infrastructure/workspace/workspaceDocuments";

const PAGE_TYPE_SORT_ORDER = {
	mainpage: 0,
	"1hopLink": 1,
	"2hopLink": 2,
} as const;

interface ExportPageData {
	file: TFile;
	type: "mainpage" | "1hopLink" | "2hopLink";
}

export async function exportToClipboard(
	app: App,
	result: TwoHopLinkResult,
): Promise<void> {
	try {
		const content = await generateExportContent(app, result);
		const ownerWindow = resolveWorkspaceDocument(app.workspace)?.defaultView;
		if (!ownerWindow) throw new Error("No active workspace window");
		await ownerWindow.navigator.clipboard.writeText(content);
		new Notice("2-hop links exported to clipboard!");
	} catch (error) {
		console.error("Failed to export 2-hop links:", error);
		new Notice("Failed to export 2-hop links. Check console for details.");
	}
}

export async function downloadAsFile(
	app: App,
	result: TwoHopLinkResult,
): Promise<void> {
	try {
		const content = await generateExportContent(app, result);
		const fileName = `2-Hop Links - ${result.originFile.basename}.txt`;
		const ownerDocument = resolveWorkspaceDocument(app.workspace);
		const ownerWindow = ownerDocument?.defaultView;
		if (!ownerDocument || !ownerWindow) {
			throw new Error("No active workspace window");
		}

		const blob = new Blob([content], {
			type: "text/plain;charset=utf-8",
		});
		const url = URL.createObjectURL(blob);

		const link = ownerDocument.createElement("a");
		link.href = url;
		link.download = fileName;
		link.style.display = "none";
		ownerDocument.body.appendChild(link);

		link.click();
		link.remove();
		ownerWindow.setTimeout(() => URL.revokeObjectURL(url), 100);
	} catch (error) {
		console.error("Failed to download file:", error);
		new Notice("Failed to download file. Check console for details.");
	}
}

async function generateExportContent(
	app: App,
	result: TwoHopLinkResult,
): Promise<string> {
	const pagesMap = new Map<string, ExportPageData>();

	// Main Page
	if (result.originFile.extension === "md") {
		pagesMap.set(result.originFile.path, {
			file: result.originFile,
			type: "mainpage",
		});
	}

	// 1-hop Links (Directly connected)
	// Outgoing (Branches)
	for (const branch of result.branches) {
		const path = branch.hop1.path;
		if (path && !branch.hop1.isUnresolved) {
			const file = resolveFileByPath(app.vault, path);
			if (file && file.extension === "md" && !pagesMap.has(path)) {
				pagesMap.set(path, { file, type: "1hopLink" });
			}
		}
	}
	// Incoming (Backlinks) - Treat as 1-hop
	for (const backlink of result.backlinks) {
		const path = backlink.sourceFile.path;
		if (backlink.sourceFile.extension === "md" && !pagesMap.has(path)) {
			pagesMap.set(path, {
				file: backlink.sourceFile,
				type: "1hopLink",
			});
		}
	}

	// 2-hop Links (Indirectly connected)
	for (const branch of result.branches) {
		for (const hop2 of branch.hop2) {
			const file = hop2.sourceFile;
			const path = file.path;

			// Only add if not already present (priority: main > 1hop > 2hop)
			if (file.extension === "md" && !pagesMap.has(path)) {
				pagesMap.set(path, { file, type: "2hopLink" });
			}
		}
	}

	let count1Hop = 0;
	let count2Hop = 0;
	for (const page of pagesMap.values()) {
		if (page.type === "1hopLink") count1Hop++;
		if (page.type === "2hopLink") count2Hop++;
	}

	const lines: string[] = [];
	const hasMainPage = pagesMap.has(result.originFile.path);
	const mainPageMsg = hasMainPage ? "main page + " : "";

	lines.push(
		`Total pages included: ${pagesMap.size} (${mainPageMsg}${count1Hop} directly linked + ${count2Hop} indirectly linked pages).`,
	);
	lines.push("");
	lines.push("<PageList>");

	// Sort order: mainpage -> 1hopLink -> 2hopLink
	const sortedPages = Array.from(pagesMap.values()).sort(
		(a, b) => PAGE_TYPE_SORT_ORDER[a.type] - PAGE_TYPE_SORT_ORDER[b.type],
	);

	for (const pageData of sortedPages) {
		const { file, type } = pageData;
		const content = await app.vault.cachedRead(file);
		const created = new Date(file.stat.ctime).toISOString();
		const updated = new Date(file.stat.mtime).toISOString();
		const title = file.basename;

		lines.push(
			`<Page title="${title}" path="${file.path}" updated="${updated}" created="${created}" type="${type}">`,
		);
		lines.push(content.trim());
		lines.push("</Page>");
		lines.push("");
		lines.push("");
	}

	lines.push("</PageList>");

	return lines.join("\n");
}
