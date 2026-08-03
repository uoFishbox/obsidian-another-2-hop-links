import type { TFile } from "obsidian";
import {
	applyAttributeToElement,
	applyAttributeToElements,
	clearAttributeFromContainer,
} from "./attributeApplier";
import {
	collectDecorationTargets,
	type DecorationTargetCollectionOptions,
	type DecorationTargetMode,
} from "./decorationTargetCollector";
import type { LinkStatusService } from "./linkStatusService";
import { UNRESOLVED_LINK_ATTRIBUTE } from "../../appConstants";
import { enableLogging, logger } from "shared/logging/logger";

export type LinkHrefExtractor = (el: HTMLElement) => string | undefined;

type LinkElementCollection = Iterable<HTMLElement> & {
	readonly length: number;
};

export interface LinkDecorationRequest {
	containerEl: HTMLElement;
	linkElements: LinkElementCollection;
	sourceFile?: TFile;
	sourcePath?: string;
	targetSelectors?: string[];
	hrefExtractor?: LinkHrefExtractor;
	mode?: DecorationTargetMode;
	shouldLogCanvas?: boolean;
}

const EMPTY_TARGET_SELECTORS: string[] = [];
const APPLY_UNRESOLVED_LINK_ATTRIBUTE_OPTIONS = {
	attrName: UNRESOLVED_LINK_ATTRIBUTE.NAME,
	attrValue: UNRESOLVED_LINK_ATTRIBUTE.VALUE_SPECIAL,
	shouldApply: true,
};
const REMOVE_UNRESOLVED_LINK_ATTRIBUTE_OPTIONS = {
	attrName: UNRESOLVED_LINK_ATTRIBUTE.NAME,
	attrValue: UNRESOLVED_LINK_ATTRIBUTE.VALUE_SPECIAL,
	shouldApply: false,
};
const EMPTY_RESOLUTION_MAP: ReadonlyMap<string, boolean> = Object.freeze(
	new Map<string, boolean>(),
);

export interface LinkDecorationReconciler {
	reconcile(request: LinkDecorationRequest): void;
	clearAttributeFromContainer(container: HTMLElement, attrName: string): void;
}

export function createLinkDecorationReconciler(
	linkStatusService: LinkStatusService,
): LinkDecorationReconciler {
	function reconcile(request: LinkDecorationRequest): void {
		const mode = request.mode ?? "rendered";
		const targetSelectors = request.targetSelectors ?? EMPTY_TARGET_SELECTORS;
		const shouldLogCanvas = request.shouldLogCanvas ?? false;

		if (shouldLogCanvas && enableLogging) {
			logger(
				`[DEBUG_CANVAS] decorateLinksInContainer called for: ${request.sourcePath ?? "unknown"}`,
			);
			logger(
				`[DEBUG_CANVAS] Found ${request.linkElements.length} internal links in container.`,
			);
		}
		const targetCollectionOptions = {
			mode,
			targetSelectors,
		};
		const { decorationRecords, lookupPaths } = collectDecorationRecords(
			linkStatusService,
			request,
			targetCollectionOptions,
		);

		logCanvasLookupPaths(shouldLogCanvas, lookupPaths);
		const resolutionResults = resolveLookupPaths(linkStatusService, lookupPaths);
		logCanvasResolutionResults(shouldLogCanvas, resolutionResults);

		const appliedCount = applyDecorationRecords(
			decorationRecords,
			resolutionResults,
			shouldLogCanvas,
		);
		if (shouldLogCanvas && enableLogging) {
			logger(`[DEBUG_CANVAS] Total attributes applied: ${appliedCount}`);
		}
	}

	function clearContainerAttribute(container: HTMLElement, attrName: string): void {
		clearAttributeFromContainer(container, attrName);
	}

	return {
		reconcile,
		clearAttributeFromContainer: clearContainerAttribute,
	};
}

interface DecorationRecord {
	linkEl: HTMLElement;
	lookupPath: string | undefined;
	targets: HTMLElement[] | null;
}

function collectDecorationRecords(
	linkStatusService: LinkStatusService,
	request: Required<Pick<LinkDecorationRequest, "containerEl" | "linkElements">> &
		Pick<LinkDecorationRequest, "hrefExtractor" | "sourceFile">,
	targetCollectionOptions: DecorationTargetCollectionOptions,
): {
	decorationRecords: DecorationRecord[];
	lookupPaths: Set<string>;
} {
	const lookupPaths = new Set<string>();
	const decorationRecords: DecorationRecord[] = [];

	for (const linkEl of request.linkElements) {
		const href = request.hrefExtractor
			? request.hrefExtractor(linkEl)
			: linkStatusService.extractHref(linkEl);
		const normalizedPath = href ? linkStatusService.normalizeHref(href) : undefined;
		const lookupPath = normalizedPath
			? linkStatusService.generateLookupPath(normalizedPath, request.sourceFile)
			: undefined;
		const targets = collectDecorationTargets(linkEl, targetCollectionOptions);

		if (lookupPath) {
			lookupPaths.add(lookupPath);
		}
		decorationRecords.push({ linkEl, lookupPath, targets });
	}

	return { decorationRecords, lookupPaths };
}

function resolveLookupPaths(
	linkStatusService: LinkStatusService,
	lookupPaths: Set<string>,
): ReadonlyMap<string, boolean> {
	if (lookupPaths.size === 0) {
		return EMPTY_RESOLUTION_MAP;
	}

	return linkStatusService.shouldDecorateLinkBatch(lookupPaths);
}

function applyDecorationRecords(
	decorationRecords: DecorationRecord[],
	resolutionResults: ReadonlyMap<string, boolean>,
	shouldLogCanvas: boolean,
): number {
	let appliedCount = 0;

	for (const record of decorationRecords) {
		const shouldDecorate = record.lookupPath
			? (resolutionResults.get(record.lookupPath) ?? false)
			: false;

		applyUnresolvedLinkAttribute(record.linkEl, record.targets, shouldDecorate);

		if (!shouldDecorate) {
			continue;
		}

		appliedCount++;
		if (shouldLogCanvas && enableLogging) {
			logger(
				`[DEBUG_CANVAS] Applied attribute to ${record.targets ? record.targets.length : 1} elements: (path: ${record.lookupPath})`,
			);
		}
	}

	return appliedCount;
}

function logCanvasLookupPaths(
	shouldLogCanvas: boolean,
	lookupPaths: Set<string>,
): void {
	if (!shouldLogCanvas) {
		return;
	}

	if (enableLogging)
		logger(
			`[DEBUG_CANVAS] Unique lookup paths to check: ${[...lookupPaths].join(", ")}`,
		);
}

function logCanvasResolutionResults(
	shouldLogCanvas: boolean,
	resolutionResults: ReadonlyMap<string, boolean>,
): void {
	if (!shouldLogCanvas) {
		return;
	}

	if (enableLogging)
		logger(
			`[DEBUG_CANVAS] Batch resolution results: ${JSON.stringify(Object.fromEntries(resolutionResults))}`,
		);
}

function applyUnresolvedLinkAttribute(
	linkEl: HTMLElement,
	targets: HTMLElement[] | null,
	shouldApply: boolean,
): void {
	const options = shouldApply
		? APPLY_UNRESOLVED_LINK_ATTRIBUTE_OPTIONS
		: REMOVE_UNRESOLVED_LINK_ATTRIBUTE_OPTIONS;

	if (targets === null) {
		applyAttributeToElement(linkEl, options);
		return;
	}

	applyAttributeToElements(targets, options);
}
