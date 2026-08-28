import type { TFile } from "obsidian";
import type { DataUpdateContext } from "indexing/index-service/IndexEvents";
import type { TwoHopResolverDependencies } from "two-hop/resolution/ResolverDependencies";
import type { PreviewInvalidation } from "card-preview/PreviewRevisionState.svelte";

export interface ReloadDecisionInput {
	currentFile: TFile | undefined;
	dependencies: TwoHopResolverDependencies | undefined;
	context?: DataUpdateContext;
}

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

/**
 * Decides whether an index update intersects the resolver dependency snapshot.
 * Missing or mismatched dependency generations reload conservatively.
 */
export function decideDataUpdateAction(input: ReloadDecisionInput): DataUpdateAction {
	const { currentFile, context } = input;

	if (!currentFile) {
		return { kind: "none" };
	}

	if (!context || context.affectsAll || !hasCurrentDependencies(input)) {
		return {
			kind: "reload",
			previewInvalidation: "all",
		};
	}
	const dependencies = input.dependencies;

	const previewInvalidation = getPreviewInvalidationForPaths(
		context,
		dependencies.relevantPaths,
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

	if (
		hasIntersection(context.affectedLookupKeys, dependencies.relevantLookupKeys) ||
		hasIntersection(
			context.affectedLinkSourcePaths,
			dependencies.structuralSourcePaths,
		) ||
		hasIntersection(context.affectedTags, dependencies.relevantTags) ||
		hasIntersection(context.affectedTagSourcePaths, dependencies.relevantPaths)
	) {
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

function hasCurrentDependencies(
	input: ReloadDecisionInput,
): input is ReloadDecisionInput & {
	dependencies: TwoHopResolverDependencies;
} {
	return (
		input.dependencies !== undefined &&
		input.dependencies.originPath === input.currentFile?.path
	);
}

function getPreviewInvalidationForPaths(
	context: DataUpdateContext,
	relevantPaths: ReadonlySet<string>,
): PreviewInvalidation {
	const affectedPaths = context.affectedPaths ?? [];
	if (affectedPaths.length === 0) {
		return undefined;
	}

	let matchedPaths: Set<string> | undefined;
	for (const path of affectedPaths) {
		if (!relevantPaths.has(path)) continue;
		matchedPaths ??= new Set<string>();
		matchedPaths.add(path);
	}

	return matchedPaths;
}

function hasIntersection(
	affectedValues: readonly string[],
	relevantValues: ReadonlySet<string>,
): boolean {
	for (const value of affectedValues) {
		if (relevantValues.has(value)) {
			return true;
		}
	}
	return false;
}
