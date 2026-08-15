import { getLinkpath, type Pos, type TFile } from "obsidian";

import type {
	CachedMetadataWithLinkReferences,
	FrontMatterLinkReference,
	LinkReference,
	TwoHopIndexedLink,
} from "types";
import { collectLinkReferences } from "core/indexing/metadata/metadataExtractor";

type RuntimeMetadataCache = {
	getFirstLinkpathDest?: (linkpath: string, sourcePath: string) => TFile | null;
};

type RuntimeBacklinkNavigation =
	| { kind: "property"; key: string }
	| { kind: "body"; position: Pos }
	| { kind: "none" };

function getTargetPath(link: TwoHopIndexedLink): string | undefined {
	return link.lookupPath ?? link.path;
}

function isReferenceToTarget(
	metadataCache: RuntimeMetadataCache | null | undefined,
	reference: LinkReference,
	link: TwoHopIndexedLink,
): boolean {
	const rawLinkPath = getLinkpath(reference.link);
	const targetPath = getTargetPath(link);

	if (metadataCache?.getFirstLinkpathDest && targetPath) {
		const resolved = metadataCache.getFirstLinkpathDest(
			rawLinkPath,
			link.sourceFile.path,
		);
		if (resolved) {
			return resolved.path === targetPath;
		}
	}

	// Keep unresolved/stale-cache navigation usable without persisting property keys.
	return rawLinkPath === getLinkpath(link.rawText);
}

function findFirstTargetProperty(
	metadataCache: RuntimeMetadataCache | null | undefined,
	cache: CachedMetadataWithLinkReferences | null,
	link: TwoHopIndexedLink,
): FrontMatterLinkReference | undefined {
	const frontmatterLinks = cache?.frontmatterLinks;
	if (!frontmatterLinks) {
		return undefined;
	}

	for (let index = 0; index < frontmatterLinks.length; index += 1) {
		const reference = frontmatterLinks[index];
		if (isReferenceToTarget(metadataCache, reference, link)) {
			return reference;
		}
	}

	return undefined;
}

function findFirstTargetBodyPosition(
	metadataCache: RuntimeMetadataCache | null | undefined,
	cache: CachedMetadataWithLinkReferences | null,
	link: TwoHopIndexedLink,
): Pos | undefined {
	const references = collectLinkReferences(cache);
	for (let index = 0; index < references.length; index += 1) {
		const reference = references[index];
		if ("key" in reference || !("position" in reference) || !reference.position) {
			continue;
		}
		if (isReferenceToTarget(metadataCache, reference, link)) {
			return reference.position;
		}
	}

	return undefined;
}

/**
 * Resolve navigation metadata at interaction time instead of storing property
 * keys in the backlink index. Property links intentionally win over body links;
 * when multiple properties point to the same target, the first property wins.
 */
function resolveRuntimeBacklinkNavigation(
	cache: CachedMetadataWithLinkReferences | null,
	link: TwoHopIndexedLink,
	metadataCache?: RuntimeMetadataCache | null,
): RuntimeBacklinkNavigation {
	const property = findFirstTargetProperty(metadataCache, cache, link);
	if (property) {
		return { kind: "property", key: property.key };
	}

	const position = findFirstTargetBodyPosition(metadataCache, cache, link);
	if (position) {
		return { kind: "body", position };
	}

	return { kind: "none" };
}

export function hydrateRuntimeBacklinkLink(
	cache: CachedMetadataWithLinkReferences | null,
	link: TwoHopIndexedLink,
	metadataCache?: RuntimeMetadataCache | null,
): TwoHopIndexedLink {
	const navigation = resolveRuntimeBacklinkNavigation(cache, link, metadataCache);

	switch (navigation.kind) {
		case "property":
			return {
				...link,
				position: undefined,
				key: navigation.key,
			};
		case "body":
			return {
				...link,
				position: navigation.position,
				key: undefined,
			};
		case "none":
			return {
				...link,
				key: undefined,
			};
	}
}

/** Resolve hover highlighting from current metadata without hydrating property keys. */
export function hydrateRuntimeBacklinkHoverLink(
	cache: CachedMetadataWithLinkReferences | null,
	link: TwoHopIndexedLink,
	metadataCache?: RuntimeMetadataCache | null,
): TwoHopIndexedLink {
	const position = findFirstTargetBodyPosition(metadataCache, cache, link);
	if (!position) {
		return { ...link, key: undefined };
	}

	return {
		...link,
		position,
		key: undefined,
	};
}
