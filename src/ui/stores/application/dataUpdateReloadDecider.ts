import type { TFile } from "obsidian";
import {
	normalizeLinkToMarkdownPath,
	toCaseInsensitiveLookupKey,
} from "core/indexing/link-resolution/linkResolution";
import type { DataUpdateContext } from "core/indexing/index-service/IndexEvents";
import type { TwoHopLinkResult } from "types";

export interface ReloadDecisionInput {
	currentFile: TFile | undefined;
	data: TwoHopLinkResult | undefined;
	context?: DataUpdateContext;
}

interface RelevantSets {
	paths: Set<string>;
	lookupKeys: Set<string>;
	structuralSourcePaths: Set<string>;
	tags: Set<string>;
}

export type PreviewInvalidation = "all" | Set<string> | undefined;

export type DataUpdateAction =
	| {
			kind: "reload";
			previewInvalidation: PreviewInvalidation;
	  }
	| {
			kind: "preview-only";
			previewInvalidation: Set<string>;
	  }
	| {
			kind: "none";
			previewInvalidation?: undefined;
	  };

export function shouldReloadForUpdate(input: ReloadDecisionInput): boolean {
	const { currentFile, data, context } = input;
	if (!currentFile) {
		return false;
	}
	if (!context || context.affectsAll) {
		return true;
	}

	const previewInvalidation = getPreviewInvalidation(input);
	if (
		previewInvalidation === "all" ||
		(previewInvalidation instanceof Set && previewInvalidation.size > 0)
	) {
		return true;
	}

	const affectedLookupKeys = context.affectedLookupKeys ?? [];
	if (affectedLookupKeys.length === 0) {
		return true;
	}

	const relevantLookupKeys = collectRelevantLookupKeys(currentFile, data);
	for (const lookupKey of affectedLookupKeys) {
		if (relevantLookupKeys.has(lookupKey)) {
			return true;
		}
	}
	return false;
}

export function getPreviewInvalidation(
	input: ReloadDecisionInput,
): PreviewInvalidation {
	const { currentFile, data, context } = input;
	if (!currentFile) {
		return undefined;
	}
	if (!context || context.affectsAll) {
		return "all";
	}

	const affectedPaths = context.affectedPaths ?? [];
	if (affectedPaths.length === 0) {
		return undefined;
	}

	const relevantPaths = collectRelevantPaths(currentFile, data);
	return getPreviewInvalidationForPaths(context, relevantPaths);
}

function getPreviewInvalidationForPaths(
	context: DataUpdateContext,
	relevantPaths: Set<string>,
): PreviewInvalidation {
	const affectedPaths = context.affectedPaths ?? [];
	if (affectedPaths.length === 0) {
		return undefined;
	}

	let matchedPaths: Set<string> | undefined;

	for (const path of affectedPaths) {
		if (relevantPaths.has(path)) {
			matchedPaths ??= new Set<string>();
			matchedPaths.add(path);
		}
	}

	return matchedPaths;
}

function collectRelevantSets(
	currentFile: TFile,
	data: TwoHopLinkResult | undefined,
): RelevantSets {
	return {
		paths: collectRelevantPaths(currentFile, data),
		lookupKeys: collectRelevantLookupKeys(currentFile, data),
		structuralSourcePaths: collectStructuralSourcePaths(currentFile, data),
		tags: collectRelevantTags(data),
	};
}

function collectRelevantPaths(
	currentFile: TFile,
	data: TwoHopLinkResult | undefined,
): Set<string> {
	const paths = new Set<string>();
	paths.add(currentFile.path);

	if (!data) {
		return paths;
	}

	paths.add(data.originFile.path);

	for (const branch of data.branches) {
		if (branch.hop1.path) {
			paths.add(branch.hop1.path);
		}
		for (const hop2 of branch.hop2) {
			paths.add(hop2.sourceFile.path);
		}
	}

	for (const backlink of data.backlinks) {
		paths.add(backlink.sourceFile.path);
	}

	for (const tagged of data.taggedNotes) {
		paths.add(tagged.path);
	}

	return paths;
}

function collectRelevantLookupKeys(
	currentFile: TFile,
	data: TwoHopLinkResult | undefined,
): Set<string> {
	const keys = new Set<string>();
	keys.add(toCaseInsensitiveLookupKey(currentFile.path));

	if (!data) {
		return keys;
	}

	for (const branch of data.branches) {
		const lookupPath =
			branch.hop1.path ?? normalizeLinkToMarkdownPath(branch.hop1.rawText);
		keys.add(toCaseInsensitiveLookupKey(lookupPath));
	}

	return keys;
}

/**
 * データ更新に対するアクションを 3 分岐で判定する。
 * - reload: two-hop 構造に影響する変更
 * - preview-only: 表示中カードの本文/ frontmatter のみ変更
 * - none: 無関係な変更
 */
export function decideDataUpdateAction(input: ReloadDecisionInput): DataUpdateAction {
	const { currentFile, data, context } = input;

	if (!currentFile) {
		return { kind: "none" };
	}

	if (!context || context.affectsAll) {
		return {
			kind: "reload",
			previewInvalidation: "all",
		};
	}

	const relevantSets = collectRelevantSets(currentFile, data);
	const previewInvalidation = getPreviewInvalidationForPaths(
		context,
		relevantSets.paths,
	);

	// 旧形式や不完全な context は安全側に倒す
	if (
		context.affectedLookupKeys === undefined ||
		context.affectedLinkSourcePaths === undefined ||
		context.affectedTags === undefined ||
		context.affectedTagSourcePaths === undefined
	) {
		return {
			kind: "reload",
			previewInvalidation,
		};
	}

	if (hasRelevantLookupChange(context, relevantSets.lookupKeys)) {
		return {
			kind: "reload",
			previewInvalidation,
		};
	}

	if (hasRelevantLinkSourceChange(context, relevantSets.structuralSourcePaths)) {
		return {
			kind: "reload",
			previewInvalidation,
		};
	}

	if (hasRelevantTagChange(context, relevantSets.tags)) {
		return {
			kind: "reload",
			previewInvalidation,
		};
	}

	if (hasRelevantTagSourceChange(context, relevantSets.paths)) {
		return {
			kind: "reload",
			previewInvalidation,
		};
	}

	if (previewInvalidation instanceof Set && previewInvalidation.size > 0) {
		return {
			kind: "preview-only",
			previewInvalidation,
		};
	}

	return { kind: "none" };
}

function hasRelevantLookupChange(
	context: DataUpdateContext,
	relevantLookupKeys: Set<string>,
): boolean {
	const affectedLookupKeys = context.affectedLookupKeys ?? [];
	if (affectedLookupKeys.length === 0) return false;

	return affectedLookupKeys.some((key) => relevantLookupKeys.has(key));
}

function hasRelevantLinkSourceChange(
	context: DataUpdateContext,
	structuralSourcePaths: Set<string>,
): boolean {
	const changed = context.affectedLinkSourcePaths;
	if (!changed || changed.length === 0) return false;

	for (const path of changed) {
		if (structuralSourcePaths.has(path)) {
			return true;
		}
	}

	return false;
}

function hasRelevantTagChange(
	context: DataUpdateContext,
	relevantTags: Set<string>,
): boolean {
	const affectedTags = context.affectedTags ?? [];
	if (affectedTags.length === 0) return false;

	if (relevantTags.size === 0) return false;

	return affectedTags.some((tag) => relevantTags.has(tag));
}

/**
 * 現在の表示に関連するタグ集合を収集する。
 * taggedNotes の commonTags は currentFile と共有しているタグを表す。
 */
function collectRelevantTags(data: TwoHopLinkResult | undefined): Set<string> {
	const tags = new Set<string>();

	if (!data) {
		return tags;
	}

	// taggedNotes のタグは表示に直接関係する
	for (const tagged of data.taggedNotes) {
		for (const tag of tagged.commonTags) {
			if (tag) {
				// 親タグも含める（例: "project/sub" -> "project", "project/sub"）
				let slash = tag.indexOf("/");
				while (slash !== -1) {
					tags.add(tag.slice(0, slash));
					slash = tag.indexOf("/", slash + 1);
				}
				tags.add(tag);
			}
		}
	}

	return tags;
}

/**
 * タグ membership が変わった source file が現在の表示に関連するかを判定する。
 */
function hasRelevantTagSourceChange(
	context: DataUpdateContext,
	relevantPaths: Set<string>,
): boolean {
	const changed = context.affectedTagSourcePaths;
	if (!changed || changed.length === 0) return false;

	for (const path of changed) {
		if (relevantPaths.has(path)) {
			return true;
		}
	}

	return false;
}

/**
 * two-hop 構造に影響を与える source file paths を収集する。
 * これらのファイルのリンク構造が変わった場合は reload が必要。
 */
function collectStructuralSourcePaths(
	currentFile: TFile,
	data: TwoHopLinkResult | undefined,
): Set<string> {
	const paths = new Set<string>();
	paths.add(currentFile.path);

	if (!data) {
		return paths;
	}

	// hop1 の outgoing link は two-hop 構造に直接影響
	for (const branch of data.branches) {
		if (branch.hop1.path) {
			paths.add(branch.hop1.path);
		}
	}

	// backlink source が current への link 関係を変えた場合
	for (const backlink of data.backlinks) {
		paths.add(backlink.sourceFile.path);
	}

	// tagged notes は tag section に影響
	for (const tagged of data.taggedNotes) {
		paths.add(tagged.path);
	}

	return paths;
}
