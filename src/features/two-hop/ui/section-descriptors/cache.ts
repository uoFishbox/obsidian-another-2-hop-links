import type { TFile } from "obsidian";
import type { DisplayData } from "features/two-hop/application/displayDataBuilder";
import {
	createCompactSectionId,
	SHOULD_VALIDATE_SECTION_IDS,
} from "ui/components/common/listPagination";
import { newLinksSectionConfig } from "ui/components/sections/sectionConfigs";
import { generateBranchKey } from "features/preview/text-processing/textUtils";
import type { PluginSettings, SortOption } from "features/settings/model";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { InteractionSettings } from "ui/interactions/interactionTypes";
import type { TwoHopVirtualSectionDescriptor } from "features/two-hop/ui/twoHopVirtualListModel";
import {
	createTwoHopInteractionTokenAllocator,
	type TwoHopInteractionTokenAllocator,
} from "./interactionTokenAllocator";
import {
	createBranchSectionDescriptor,
	resolveBranchHeader,
	type BranchSectionBuildInput,
} from "./createBranchDescriptor";
import {
	createPrimarySectionDescriptor,
	type PrimarySectionBuildInput,
} from "./createPrimaryDescriptor";
import {
	createTagSectionDescriptor,
	type TagSectionBuildInput,
} from "./createTagDescriptor";
import { createNewLinksSectionDescriptor } from "./createNewLinksDescriptor";
import { hasSameSectionSignature, type SectionSignature } from "./sectionSignature";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";

export interface ResolveTwoHopSectionDescriptorIdentityParams {
	readonly displayData: DisplayData;
	readonly useMergedLinks: boolean;
	readonly showTags: boolean;
	readonly sourceFile: TFile;
	readonly resolveFile: (path: string) => TFile | null;
	readonly fileToLinktext: (
		file: TFile,
		sourcePath: string,
		omitMdExtension?: boolean,
	) => string;
	readonly currentSort: SortOption;
	readonly currentSettings: PluginSettings;
	readonly applicationStore: ApplicationStore;
	readonly onTagClick: (tag: string) => void;
}

/**
 * Page-owned section publication cache.
 *
 * Reconciliation stops at the section boundary: an equal semantic signature
 * reuses the complete immutable descriptor, while a changed signature eagerly
 * builds a fresh item publication. Interaction tokens remain page-owned and
 * are therefore stable across section publications.
 */
export interface TwoHopSectionDescriptorIdentityCache {
	resolve(
		params: ResolveTwoHopSectionDescriptorIdentityParams,
	): readonly TwoHopVirtualSectionDescriptor[];
}

interface CachedSection {
	readonly signature: SectionSignature;
	readonly descriptor: TwoHopVirtualSectionDescriptor;
}

type SectionSpec =
	| {
			readonly kind: "primary";
			readonly signature: Extract<SectionSignature, { kind: "primary" }>;
	  }
	| {
			readonly kind: "branch";
			readonly signature: Extract<SectionSignature, { kind: "branch" }>;
			readonly buildInput: BranchSectionBuildInput;
	  }
	| {
			readonly kind: "tag";
			readonly signature: Extract<SectionSignature, { kind: "tag" }>;
			readonly buildInput: TagSectionBuildInput;
	  }
	| {
			readonly kind: "new-links";
			readonly signature: Extract<SectionSignature, { kind: "new-links" }>;
	  };

interface ResolveInputSnapshot {
	readonly displayData: DisplayData;
	readonly useMergedLinks: boolean;
	readonly showTags: boolean;
	readonly sourcePath: string;
	readonly resolveFile: ResolveTwoHopSectionDescriptorIdentityParams["resolveFile"];
	readonly fileToLinktext: ResolveTwoHopSectionDescriptorIdentityParams["fileToLinktext"];
	readonly currentSort: SortOption;
	readonly sortContextVersion: number;
	readonly mobileLongPressAction: PluginSettings["mobileLongPressAction"];
	readonly highlightInPreviewOnHover: boolean;
}

function createResolveInputSnapshot(
	params: ResolveTwoHopSectionDescriptorIdentityParams,
): ResolveInputSnapshot {
	return {
		displayData: params.displayData,
		useMergedLinks: params.useMergedLinks,
		showTags: params.showTags,
		sourcePath: params.sourceFile.path,
		resolveFile: params.resolveFile,
		fileToLinktext: params.fileToLinktext,
		currentSort: params.currentSort,
		sortContextVersion: params.applicationStore.getSortContextVersion?.() ?? 0,
		mobileLongPressAction: params.currentSettings.mobileLongPressAction,
		highlightInPreviewOnHover: params.currentSettings.highlightInPreviewOnHover,
	};
}

function hasSameResolveInputs(
	current: ResolveInputSnapshot,
	next: ResolveInputSnapshot,
): boolean {
	return (
		current.displayData === next.displayData &&
		current.useMergedLinks === next.useMergedLinks &&
		current.showTags === next.showTags &&
		current.sourcePath === next.sourcePath &&
		current.resolveFile === next.resolveFile &&
		current.fileToLinktext === next.fileToLinktext &&
		current.currentSort === next.currentSort &&
		current.sortContextVersion === next.sortContextVersion &&
		current.mobileLongPressAction === next.mobileLongPressAction &&
		current.highlightInPreviewOnHover === next.highlightInPreviewOnHover
	);
}

function createInteractionSettings(settings: PluginSettings): InteractionSettings {
	return Object.freeze({
		mobileLongPressAction: settings.mobileLongPressAction,
		highlightInPreviewOnHover: settings.highlightInPreviewOnHover,
	});
}

function createSectionSpecs(
	params: ResolveTwoHopSectionDescriptorIdentityParams,
	onTagClick: (tag: string) => void,
): SectionSpec[] {
	const specs: SectionSpec[] = [];
	appendPrimarySpecs(specs, params);
	appendBranchSpecs(specs, params);
	appendTagSpecs(specs, params, onTagClick);
	appendNewLinksSpec(specs, params);
	return specs;
}

function appendPrimarySpecs(
	specs: SectionSpec[],
	params: ResolveTwoHopSectionDescriptorIdentityParams,
): void {
	if (params.useMergedLinks) {
		if (params.displayData.mergedItems.length === 0) return;
		specs.push({
			kind: "primary",
			signature: {
				kind: "primary",
				input: {
					kind: "merged",
					items: params.displayData.mergedItems,
				},
			},
		});
		return;
	}

	if (params.displayData.outgoing.length > 0) {
		specs.push({
			kind: "primary",
			signature: {
				kind: "primary",
				input: {
					kind: "outgoing",
					items: params.displayData.outgoing,
				},
			},
		});
	}
	if (params.displayData.backlinks.length > 0) {
		specs.push({
			kind: "primary",
			signature: {
				kind: "primary",
				input: {
					kind: "backlinks",
					items: params.displayData.backlinks,
				},
			},
		});
	}
}

function appendBranchSpecs(
	specs: SectionSpec[],
	params: ResolveTwoHopSectionDescriptorIdentityParams,
): void {
	const interactionSettings = createInteractionSettings(params.currentSettings);
	const sortContextVersion = params.applicationStore.getSortContextVersion?.() ?? 0;

	for (const branch of params.displayData.twoHopBranches) {
		const sectionKey = generateBranchKey(branch);
		const rawSectionId = createCompactSectionId("twohop", sectionKey);
		const header = resolveBranchHeader({
			branch,
			sourceFile: params.sourceFile,
			resolveFile: params.resolveFile,
			fileToLinktext: params.fileToLinktext,
		});
		const signature: Extract<SectionSignature, { kind: "branch" }> = {
			kind: "branch",
			branch,
			rawSectionId,
			sectionKey,
			...header,
			sortOption: params.currentSort,
			sortContextVersion,
			getSortedItems: params.applicationStore.getSortedTwoHopItems,
			interactionSettings,
		};
		specs.push({
			kind: "branch",
			signature,
			buildInput: {
				branch,
				rawSectionId,
				sectionKey,
				sourceFile: params.sourceFile,
				...header,
				interactionSettings,
				applicationStore: params.applicationStore,
			},
		});
	}
}

function appendTagSpecs(
	specs: SectionSpec[],
	params: ResolveTwoHopSectionDescriptorIdentityParams,
	onTagClick: (tag: string) => void,
): void {
	if (!params.showTags) return;
	const sortContextVersion = params.applicationStore.getSortContextVersion?.() ?? 0;

	for (const source of params.displayData.tagGroups) {
		const rawSectionId = `tags-${source.tag}`;
		specs.push({
			kind: "tag",
			signature: {
				kind: "tag",
				source,
				rawSectionId,
				sortOption: params.currentSort,
				sortContextVersion,
				getSortedItems: params.applicationStore.getSortedTagGroupItems,
			},
			buildInput: {
				source,
				rawSectionId,
				applicationStore: params.applicationStore,
				onTagClick,
			},
		});
	}
}

function appendNewLinksSpec(
	specs: SectionSpec[],
	params: ResolveTwoHopSectionDescriptorIdentityParams,
): void {
	if (params.displayData.newLinks.length === 0) return;
	specs.push({
		kind: "new-links",
		signature: {
			kind: "new-links",
			items: params.displayData.newLinks,
		},
	});
}

function getSectionId(signature: SectionSignature): string {
	switch (signature.kind) {
		case "primary":
			return signature.input.kind;
		case "branch":
		case "tag":
			return signature.rawSectionId;
		case "new-links":
			return newLinksSectionConfig.sectionId;
	}
}

function snapshotSpec(spec: SectionSpec): SectionSpec {
	switch (spec.kind) {
		case "primary": {
			const input = {
				...spec.signature.input,
				items: [...spec.signature.input.items],
			} as PrimarySectionBuildInput;
			return {
				kind: "primary",
				signature: { kind: "primary", input },
			};
		}
		case "branch": {
			const branch = {
				...spec.signature.branch,
				hop2: [...spec.signature.branch.hop2],
			};
			return {
				kind: "branch",
				signature: {
					...spec.signature,
					branch,
				},
				buildInput: {
					...spec.buildInput,
					branch,
				},
			};
		}
		case "tag": {
			const source = {
				...spec.signature.source,
				notes: [...spec.signature.source.notes],
			};
			return {
				kind: "tag",
				signature: {
					...spec.signature,
					source,
				},
				buildInput: {
					...spec.buildInput,
					source,
				},
			};
		}
		case "new-links":
			return {
				kind: "new-links",
				signature: {
					...spec.signature,
					items: [...spec.signature.items],
				},
			};
	}
}

function buildDescriptor(
	spec: SectionSpec,
	tokens: TwoHopInteractionTokenAllocator,
): TwoHopVirtualSectionDescriptor {
	switch (spec.kind) {
		case "primary":
			return createPrimarySectionDescriptor({
				input: spec.signature.input,
				createItemInteractionToken: tokens.createItemInteractionToken,
			});
		case "branch":
			return createBranchSectionDescriptor(spec.buildInput, tokens);
		case "tag":
			return createTagSectionDescriptor(spec.buildInput, tokens);
		case "new-links":
			return createNewLinksSectionDescriptor({
				items: spec.signature.items,
				createItemInteractionToken: tokens.createItemInteractionToken,
			});
	}
}

export function createTwoHopSectionDescriptorIdentityCache(): TwoHopSectionDescriptorIdentityCache {
	const entries = new Map<string, CachedSection>();
	const tokens = createTwoHopInteractionTokenAllocator();
	let latestOnTagClick: (tag: string) => void = () => undefined;
	const onTagClick = (tag: string): void => latestOnTagClick(tag);
	let previousDescriptors: readonly TwoHopVirtualSectionDescriptor[] = [];
	let previousInputs: ResolveInputSnapshot | undefined;

	return {
		resolve(params) {
			latestOnTagClick = params.onTagClick;
			const inputs = createResolveInputSnapshot(params);
			if (previousInputs && hasSameResolveInputs(previousInputs, inputs)) {
				recordCacheMeasurement("exactHit");
				recordCacheMeasurement("hit");
				return previousDescriptors;
			}

			const specs = createSectionSpecs(params, onTagClick);
			const activeSectionIds = new Set<string>();
			const seenSectionIds = SHOULD_VALIDATE_SECTION_IDS
				? new Map<string, number>()
				: null;
			const descriptors: TwoHopVirtualSectionDescriptor[] = [];
			let changed = false;

			for (const spec of specs) {
				const sectionId = getSectionId(spec.signature);
				validateSectionId(sectionId, descriptors.length, seenSectionIds);
				activeSectionIds.add(sectionId);
				const cached = entries.get(sectionId);
				if (
					cached &&
					hasSameSectionSignature(cached.signature, spec.signature)
				) {
					descriptors.push(cached.descriptor);
					continue;
				}

				const immutableSpec = snapshotSpec(spec);
				const descriptor = buildDescriptor(immutableSpec, tokens);
				entries.set(sectionId, {
					signature: immutableSpec.signature,
					descriptor,
				});
				descriptors.push(descriptor);
				changed = true;
			}

			for (const sectionId of entries.keys()) {
				if (activeSectionIds.has(sectionId)) continue;
				entries.delete(sectionId);
				changed = true;
			}

			previousDescriptors = Object.freeze(descriptors);
			previousInputs = inputs;
			recordCacheMeasurement(changed ? "miss" : "hit");
			return previousDescriptors;
		},
	};
}

function validateSectionId(
	sectionId: string,
	index: number,
	seenSectionIds: Map<string, number> | null,
): void {
	const previousIndex = seenSectionIds?.get(sectionId);
	if (previousIndex !== undefined) {
		throw new Error(
			`TwoHopSectionDescriptorIdentityCache: duplicate sectionId ${JSON.stringify(
				sectionId,
			)} at indexes ${previousIndex} and ${index}.`,
		);
	}
	seenSectionIds?.set(sectionId, index);
}

function recordCacheMeasurement(result: "exactHit" | "hit" | "miss"): void {
	if (process.env.NODE_ENV === "production") return;
	recordCCLDevMeasurement(`twoHop.sectionDescriptorIdentityCache.${result}`);
}
