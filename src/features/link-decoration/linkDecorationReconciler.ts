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

export type LinkHrefExtractor = (el: HTMLElement) => string | undefined;

export interface LinkDecorationRequest {
	containerEl: HTMLElement;
	linkElements: Iterable<HTMLElement>;
	sourceFile?: TFile;
	targetSelectors?: string[];
	hrefExtractor?: LinkHrefExtractor;
	mode?: DecorationTargetMode;
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
		const targetCollectionOptions = {
			mode,
			targetSelectors,
		};
		const { decorationRecords, lookupPaths } = collectDecorationRecords(
			linkStatusService,
			request,
			targetCollectionOptions,
		);

		const resolutionResults = resolveLookupPaths(linkStatusService, lookupPaths);
		applyDecorationRecords(decorationRecords, resolutionResults);
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
): void {
	for (const record of decorationRecords) {
		const shouldDecorate = record.lookupPath
			? (resolutionResults.get(record.lookupPath) ?? false)
			: false;

		applyUnresolvedLinkAttribute(record.linkEl, record.targets, shouldDecorate);
	}
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
