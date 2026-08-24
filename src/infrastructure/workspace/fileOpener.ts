import { MarkdownView, type Pos, type TFile, type Workspace } from "obsidian";
import type { TwoHopIndexedLink } from "types";
import { isAdvancedCanvasPosition } from "core/rules/fileRules";

type MetadataEditorLike = {
	focusProperty?: (key: string) => void;
};

type MarkdownViewWithMetadataEditor = MarkdownView & {
	metadataEditor?: MetadataEditorLike;
};

const PROPERTY_FOCUS_MAX_ATTEMPTS = 12;
const PROPERTY_FOCUS_RETRY_MS = 80;

type FileNavigationState = Record<string, unknown>;

export function buildFileNavigationState(
	file: TFile,
	position?: Pos,
): FileNavigationState | undefined {
	if (!position) return undefined;
	if (file.extension === "canvas" && isAdvancedCanvasPosition(position)) {
		return { match: { matches: [[0, position.end.offset]] } };
	}
	return { line: position.start.line, scroll: position.start.line };
}

function getPropertyFocusCandidates(rawKey: string): string[] {
	const candidates: string[] = [];
	const pushUnique = (value: string) => {
		const trimmed = value.trim();
		if (!trimmed || candidates.includes(trimmed)) {
			return;
		}
		candidates.push(trimmed);
	};

	pushUnique(rawKey);

	const hasIndexNotation =
		/\[\d+\]/.test(rawKey) || rawKey.split(".").some((seg) => /^\d+$/.test(seg));
	if (!hasIndexNotation) {
		return candidates;
	}

	const noBracketIndex = rawKey.replace(/\[\d+\]/g, "");
	const noNumericSegments = noBracketIndex
		.split(".")
		.filter((segment) => segment && !/^\d+$/.test(segment))
		.join(".");
	pushUnique(noNumericSegments);

	const rootSegment = noNumericSegments.split(".")[0] ?? "";
	pushUnique(rootSegment);

	return candidates;
}

function focusPropertyAfterOpen(
	leaf: ReturnType<Workspace["getLeaf"]>,
	key: string,
	attempt = 1,
): void {
	if (!leaf) {
		return;
	}
	if (!(leaf.view instanceof MarkdownView)) {
		return;
	}

	const markdownView = leaf.view as MarkdownViewWithMetadataEditor;
	const focusProperty = markdownView.metadataEditor?.focusProperty;
	if (typeof focusProperty === "function") {
		const candidates = getPropertyFocusCandidates(key);
		for (const candidate of candidates) {
			focusProperty.call(markdownView.metadataEditor, candidate);
		}
		return;
	}

	if (attempt >= PROPERTY_FOCUS_MAX_ATTEMPTS) {
		return;
	}

	setTimeout(() => {
		focusPropertyAfterOpen(leaf, key, attempt + 1);
	}, PROPERTY_FOCUS_RETRY_MS);
}

export async function openFile(
	workspace: Workspace,
	file: TFile,
	position?: Pos,
	newLeaf: boolean | "tab" | "split" | "window" = false,
	key?: string,
): Promise<void> {
	try {
		// 指定された newLeaf オプションに基づいて Leaf を取得
		const leaf = workspace.getLeaf(newLeaf);

		if (leaf) {
			const eState = buildFileNavigationState(file, position);

			if (
				file.extension === "canvas" &&
				position &&
				isAdvancedCanvasPosition(position)
			) {
				const elementIndex = position.end.offset;
			}

			await leaf.openFile(file, { eState });
			workspace.revealLeaf(leaf);
			if (key) {
				focusPropertyAfterOpen(leaf, key);
			}
		}
	} catch (error) {
		console.error("Failed to open file from two-hop view:", error);
	}
}

export async function openLinkDestination(
	workspace: Workspace,
	link: TwoHopIndexedLink,
	sourceFile: TFile,
	newLeaf: boolean | "tab" | "split" | "window" = false,
): Promise<void> {
	try {
		await workspace.openLinkText(link.rawText, sourceFile.path, newLeaf);
	} catch (error) {
		console.error("Failed to open link destination:", error);
	}
}
