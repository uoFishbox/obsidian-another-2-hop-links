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
import { enableLogging, logger } from "utils/logger";

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
	clearRemoved?: boolean;
	shouldLogCanvas?: boolean;
}

type LinkDecorationState = {
	href: string | undefined;
	lookupPath: string | undefined;
	shouldDecorate: boolean;
	targets: HTMLElement[] | null;
};

type ContainerState = Map<HTMLElement, LinkDecorationState>;

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
	const containerStates = new WeakMap<HTMLElement, ContainerState>();

	function reconcile(request: LinkDecorationRequest): void {
		const mode = request.mode ?? "rendered";
		const targetSelectors = request.targetSelectors ?? EMPTY_TARGET_SELECTORS;
		const clearRemoved = request.clearRemoved ?? true;
		const shouldLogCanvas = request.shouldLogCanvas ?? false;

		if (shouldLogCanvas && enableLogging) {
			logger(
				`[DEBUG_CANVAS] decorateLinksInContainer called for: ${request.sourcePath ?? "unknown"}`,
			);
			logger(
				`[DEBUG_CANVAS] Found ${request.linkElements.length} internal links in container.`,
			);
		}
		const containerState = getOrCreateContainerState(
			containerStates,
			request.containerEl,
		);
		const targetCollectionOptions = {
			mode,
			targetSelectors,
		};
		const { nextStates, lookupPaths } = buildNextStates(
			linkStatusService,
			request,
			targetCollectionOptions,
			containerState,
		);

		logCanvasLookupPaths(shouldLogCanvas, lookupPaths);
		const resolutionResults = resolveLookupPaths(linkStatusService, lookupPaths);
		logCanvasResolutionResults(shouldLogCanvas, resolutionResults);

		if (clearRemoved) {
			clearRemovedLinkStates(request.containerEl, nextStates, containerState);
		}

		const appliedCount = applyNextStates(
			nextStates,
			containerState,
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

function buildNextStates(
	linkStatusService: LinkStatusService,
	request: Required<Pick<LinkDecorationRequest, "containerEl" | "linkElements">> &
		Pick<LinkDecorationRequest, "hrefExtractor" | "sourceFile">,
	targetCollectionOptions: DecorationTargetCollectionOptions,
	containerState: ContainerState,
): {
	nextStates: Map<HTMLElement, LinkDecorationState>;
	lookupPaths: Set<string>;
} {
	const lookupPaths = new Set<string>();
	const nextStates = new Map<HTMLElement, LinkDecorationState>();

	for (const linkEl of request.linkElements) {
		const prevState = containerState.get(linkEl);
		const state = reconcileNextState(
			linkStatusService,
			linkEl,
			request,
			targetCollectionOptions,
			prevState,
		);
		if (state.lookupPath) {
			lookupPaths.add(state.lookupPath);
		}
		nextStates.set(linkEl, state);
	}

	return { nextStates, lookupPaths };
}

function reconcileNextState(
	linkStatusService: LinkStatusService,
	linkEl: HTMLElement,
	request: Pick<LinkDecorationRequest, "hrefExtractor" | "sourceFile">,
	targetCollectionOptions: DecorationTargetCollectionOptions,
	prevState: LinkDecorationState | undefined,
): LinkDecorationState {
	const href = request.hrefExtractor
		? request.hrefExtractor(linkEl)
		: linkStatusService.extractHref(linkEl);
	const normalizedPath = href ? linkStatusService.normalizeHref(href) : undefined;
	const lookupPath = normalizedPath
		? linkStatusService.generateLookupPath(normalizedPath, request.sourceFile)
		: undefined;

	if (
		prevState &&
		prevState.href === href &&
		prevState.lookupPath === lookupPath &&
		prevState.targets === null &&
		linkEl.isConnected
	) {
		return prevState;
	}

	return {
		href,
		lookupPath,
		shouldDecorate: false,
		targets: collectDecorationTargets(linkEl, targetCollectionOptions),
	};
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

function applyNextStates(
	nextStates: Map<HTMLElement, LinkDecorationState>,
	containerState: ContainerState,
	resolutionResults: ReadonlyMap<string, boolean>,
	shouldLogCanvas: boolean,
): number {
	let appliedCount = 0;

	for (const [el, nextState] of nextStates) {
		const shouldDecorate = nextState.lookupPath
			? (resolutionResults.get(nextState.lookupPath) ?? false)
			: false;
		const prevState = containerState.get(el);
		const prevShouldDecorate = prevState?.shouldDecorate ?? false;

		nextState.shouldDecorate = shouldDecorate;
		applyLinkState(el, prevState, nextState, prevShouldDecorate);
		containerState.set(el, nextState);

		if (!shouldDecorate) {
			continue;
		}

		appliedCount++;
		if (shouldLogCanvas && enableLogging) {
			logger(
				`[DEBUG_CANVAS] Applied attribute to ${nextState.targets ? nextState.targets.length : 1} elements: (path: ${nextState.lookupPath})`,
			);
		}
	}

	return appliedCount;
}

function getOrCreateContainerState(
	containerStates: WeakMap<HTMLElement, ContainerState>,
	containerEl: HTMLElement,
): ContainerState {
	let state = containerStates.get(containerEl);
	if (!state) {
		state = new Map<HTMLElement, LinkDecorationState>();
		containerStates.set(containerEl, state);
	}
	return state;
}

function clearRemovedLinkStates(
	containerEl: HTMLElement,
	nextStates: Map<HTMLElement, LinkDecorationState>,
	containerState: ContainerState,
): void {
	for (const [linkEl, state] of containerState) {
		if (
			nextStates.has(linkEl) &&
			linkEl.isConnected &&
			containerEl.contains(linkEl)
		) {
			continue;
		}

		applyUnresolvedLinkAttribute(linkEl, state.targets, false);
		containerState.delete(linkEl);
	}
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

function applyLinkState(
	linkEl: HTMLElement,
	prevState: LinkDecorationState | undefined,
	nextState: LinkDecorationState,
	prevShouldDecorate: boolean,
): void {
	if (
		prevState &&
		prevState.href === nextState.href &&
		prevState.lookupPath === nextState.lookupPath &&
		prevShouldDecorate === nextState.shouldDecorate &&
		haveSameTargets(linkEl, prevState.targets, nextState.targets)
	) {
		return;
	}

	if (prevState) {
		const removedTargets = collectMissingTargets(
			linkEl,
			prevState.targets,
			nextState.targets,
		);
		if (removedTargets) {
			applyAttributeToElements(
				removedTargets,
				REMOVE_UNRESOLVED_LINK_ATTRIBUTE_OPTIONS,
			);
		}
	}

	applyUnresolvedLinkAttribute(linkEl, nextState.targets, nextState.shouldDecorate);

	if (!nextState.shouldDecorate && prevState) {
		const addedTargets = collectMissingTargets(
			linkEl,
			nextState.targets,
			prevState.targets,
		);
		if (addedTargets) {
			applyAttributeToElements(
				addedTargets,
				REMOVE_UNRESOLVED_LINK_ATTRIBUTE_OPTIONS,
			);
		}
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

function collectMissingTargets(
	linkEl: HTMLElement,
	candidates: HTMLElement[] | null,
	existingTargets: HTMLElement[] | null,
): HTMLElement[] | undefined {
	let missingTargets: HTMLElement[] | undefined;

	if (candidates === null) {
		if (!targetExists(linkEl, existingTargets, linkEl)) {
			missingTargets ??= [];
			missingTargets.push(linkEl);
		}
		return missingTargets;
	}

	for (const target of candidates) {
		if (targetExists(target, existingTargets, linkEl)) {
			continue;
		}

		missingTargets ??= [];
		missingTargets.push(target);
	}

	return missingTargets;
}

function targetExists(
	target: HTMLElement,
	existingTargets: HTMLElement[] | null,
	linkEl: HTMLElement,
): boolean {
	if (existingTargets === null) {
		return target === linkEl;
	}

	return existingTargets.includes(target);
}

function haveSameTargets(
	linkEl: HTMLElement,
	left: HTMLElement[] | null,
	right: HTMLElement[] | null,
): boolean {
	if (left === null && right === null) {
		return true;
	}
	if (left === null) {
		return right !== null && right.length === 1 && right[0] === linkEl;
	}
	if (right === null) {
		return left.length === 1 && left[0] === linkEl;
	}
	if (left.length !== right.length) {
		return false;
	}

	for (let i = 0; i < left.length; i++) {
		if (left[i] !== right[i]) {
			return false;
		}
	}

	return true;
}
