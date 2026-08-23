import type { DataUpdateContext } from "core/indexing/index-service/IndexEvents";

export interface TagNotesRefreshDecisionInput {
	readonly tagFeaturesEnabled: boolean;
	readonly tag: string;
	readonly sourcePath: string;
	readonly context?: DataUpdateContext;
	readonly hasCurrentItemPath: (path: string) => boolean;
}

/** Decides whether an index update can change the visible tag-note result. */
export function shouldRefreshTagNotesForContext({
	tagFeaturesEnabled,
	tag,
	sourcePath,
	context,
	hasCurrentItemPath,
}: TagNotesRefreshDecisionInput): boolean {
	if (!tagFeaturesEnabled || !tag) {
		return false;
	}

	if (!context || context.affectsAll) {
		return true;
	}

	if (context.affectedTags?.includes(tag)) {
		return true;
	}

	const affectedPaths = context.affectedPaths;
	if (!affectedPaths || affectedPaths.length === 0) {
		return false;
	}

	if (sourcePath && affectedPaths.includes(sourcePath)) {
		return true;
	}

	return affectedPaths.some(hasCurrentItemPath);
}
