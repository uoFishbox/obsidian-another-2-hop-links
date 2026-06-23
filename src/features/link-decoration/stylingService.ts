import type { TFile } from "obsidian";
import type { LinkStatusService } from "features/link-decoration/linkStatusService";
import type { DecorationTargetMode } from "./decorationTargetCollector";
import {
	createLinkDecorationReconciler,
	type LinkHrefExtractor,
} from "./linkDecorationReconciler";

const PROPERTY_LINK_SELECTORS = [".multi-select-pill-content", ".metadata-link-inner"];

export interface StylingService {
	isDecorationEnabled(): boolean;
	decorateLinksInContainer(containerEl: HTMLElement, sourcePath: string): void;
	decoratePropertiesPane(propertiesEl: HTMLElement, sourceFile?: TFile): void;
	reconcileLinkElementsInContainer(
		containerEl: HTMLElement,
		linkElements: HTMLElement[],
		sourceFile?: TFile,
		targetSelectors?: string[],
		hrefExtractor?: LinkHrefExtractor,
		mode?: DecorationTargetMode,
	): void;
	clearAttributeFromContainer(container: HTMLElement, attrName: string): void;
}

export function createStylingService(
	linkStatusService: LinkStatusService,
): StylingService {
	const reconciler = createLinkDecorationReconciler(linkStatusService);

	function isDecorationEnabled(): boolean {
		return linkStatusService.isDecorationEnabled();
	}

	/**
	 * Decorate all unresolved links in a container.
	 * Equivalent to the previous LinkDecoratorService.decorateUnresolvedLinksInContainer.
	 */
	function decorateLinksInContainer(
		containerEl: HTMLElement,
		sourcePath: string,
	): void {
		const isCanvas = sourcePath.endsWith(".canvas");
		const linkNodes =
			containerEl.querySelectorAll<HTMLAnchorElement>("a.internal-link");

		reconciler.reconcile({
			containerEl,
			linkElements: linkNodes,
			mode: "rendered",
			shouldLogCanvas: isCanvas,
			sourcePath,
		});
	}

	/**
	 * Apply classes to link elements in the Properties pane.
	 */
	function decoratePropertiesPane(
		propertiesEl: HTMLElement,
		sourceFile?: TFile,
	): void {
		const linkElements = propertiesEl.querySelectorAll<HTMLElement>(
			"div.internal-link, div.metadata-link-inner",
		);

		reconciler.reconcile({
			containerEl: propertiesEl,
			linkElements,
			sourceFile,
			targetSelectors: PROPERTY_LINK_SELECTORS,
			mode: "properties",
		});
	}

	function reconcileLinkElementsInContainer(
		containerEl: HTMLElement,
		linkElements: HTMLElement[],
		sourceFile?: TFile,
		targetSelectors: string[] = [],
		hrefExtractor?: LinkHrefExtractor,
		mode: DecorationTargetMode = "rendered",
	): void {
		reconciler.reconcile({
			containerEl,
			linkElements,
			sourceFile,
			targetSelectors,
			hrefExtractor,
			mode,
		});
	}

	/**
	 * Clear specific attribute from container.
	 */
	function clearContainerAttribute(container: HTMLElement, attrName: string): void {
		reconciler.clearAttributeFromContainer(container, attrName);
	}

	return {
		isDecorationEnabled,
		decorateLinksInContainer,
		decoratePropertiesPane,
		reconcileLinkElementsInContainer,
		clearAttributeFromContainer: clearContainerAttribute,
	};
}
