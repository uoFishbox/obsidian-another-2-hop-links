import type { TFile } from "obsidian";
import type { ViewItem } from "application/presenters";
import {
	generateBacklinkKey,
	generateBranchKey,
	generateIndexedLinkKey,
} from "features/preview/text-processing/textUtils";
import type {
	AppContext,
	LinkInteractionOptions,
	LinkUtilitiesContext,
} from "ui/context/linkContext";
import type { TwoHopIndexedLink } from "types";
import type { PluginSettings } from "types/settings";
import { getItemStrategy } from "application/presenters";
import { findClosestComposed } from "ui/utils/shadowDom";
import {
	createOwnerMouseEvent,
	isElementLike,
	isEventLike,
	isHTMLElementLike,
} from "ui/utils/realmSafeDom";

export const INTERACTION_ID_ATTRIBUTE = "data-ccl-interaction-id";
export const INTERACTION_KIND_ATTRIBUTE = "data-ccl-interaction-kind";
export const LONG_PRESSED_ATTRIBUTE = "data-ccl-long-pressed";
export const INTERACTION_SELECTOR = `[${INTERACTION_ID_ATTRIBUTE}]`;
const CARD_INTERACTION_SELECTOR = `.cosense-card-links__box${INTERACTION_SELECTOR}`;
const SYNTHETIC_HOVER_EVENT_FLAG = "__cclSyntheticHover";
const LAST_TOUCH_AT_DATASET_KEY = "cclLastTouchAt";

export type InteractionKind = "item" | "sectionHeader";

interface BaseInteractionDescriptor {
	interactionId: string;
	interactionKey?: string;
	kind: InteractionKind;
	targetFile: TFile | null;
	hoverPreviewEnabled?: boolean;
	dragRawText?: string;
	filePathForDrag?: string;
	directory?: string | null;
	settings?: PluginSettings;
	searchQuery?: string;
}

export interface ItemInteractionDescriptor extends BaseInteractionDescriptor {
	kind: "item";
	item: ViewItem;
}

export interface SectionHeaderInteractionDescriptor extends BaseInteractionDescriptor {
	kind: "sectionHeader";
	link: TwoHopIndexedLink;
	isOutgoingLink: boolean;
}

export type InteractionDescriptor =
	| ItemInteractionDescriptor
	| SectionHeaderInteractionDescriptor;

export function buildInteractionDataAttributes(
	interactionId: string,
	kind: InteractionKind,
): Record<string, string> {
	return {
		[INTERACTION_ID_ATTRIBUTE]: interactionId,
		[INTERACTION_KIND_ATTRIBUTE]: kind,
	};
}

export function createItemInteractionKey(item: ViewItem, virtualKey?: string): string {
	switch (item.type) {
		case "file":
			return `item:file:${item.data.path}`;
		case "taggedNote":
			return `item:taggedNote:${item.data.path}`;
		case "branch":
			return `item:branch:${generateBranchKey(item.data, "interaction")}`;
		case "backlink":
			return virtualKey
				? `item:backlink:${virtualKey}:interaction`
				: `item:backlink:${generateBacklinkKey(item.data, "interaction")}`;
		case "newLink":
			return virtualKey
				? `item:newLink:${virtualKey}:interaction`
				: `item:newLink:${generateIndexedLinkKey(item.data, "interaction")}`;
		default:
			return "";
	}
}

export const createItemInteractionId = createItemInteractionKey;

export interface CreateItemInteractionDescriptorOptions {
	interactionId?: string;
	interactionKey?: string;
}

export function createItemInteractionDescriptor(
	item: ViewItem,
	settings: PluginSettings,
	searchQuery: string,
	context: LinkUtilitiesContext,
	options: CreateItemInteractionDescriptorOptions = {},
): ItemInteractionDescriptor | null {
	const strategy = getItemStrategy(item);
	if (!strategy) return null;

	const interactionKey = options.interactionKey ?? createItemInteractionKey(item);
	const targetFile = strategy.getTargetFile(item.data, context);
	const rawText = strategy.getRawText(item.data);

	return {
		interactionId: options.interactionId ?? interactionKey,
		interactionKey,
		kind: "item",
		item,
		targetFile,
		hoverPreviewEnabled: item.type !== "newLink" && !!targetFile,
		dragRawText: rawText,
		filePathForDrag: targetFile?.path,
		directory: targetFile?.parent?.path ?? null,
		settings,
		searchQuery,
	};
}

export function createSectionHeaderInteractionKey(sectionId: string): string {
	return `section:${sectionId}`;
}

export const createSectionHeaderInteractionId = createSectionHeaderInteractionKey;

export function resolveDescriptorInteractionOptions(
	descriptor: InteractionDescriptor,
	appContext: AppContext | undefined,
): LinkInteractionOptions {
	const normalizedSearchQuery = descriptor.searchQuery?.trim().toLowerCase() ?? "";

	if (!normalizedSearchQuery) {
		return { highlightMode: "auto" };
	}

	if (!descriptor.targetFile) {
		return { highlightMode: "suppress" };
	}

	const preferredPosition =
		appContext?.resolveSearchMatchPosition?.(
			normalizedSearchQuery,
			descriptor.targetFile,
		) ?? undefined;

	if (!preferredPosition) {
		return { highlightMode: "suppress" };
	}

	return {
		highlightMode: "force",
		preferredPosition,
	};
}

export function getInteractionElement(
	target: EventTarget | Event | null,
): HTMLElement | null {
	if (isEventLike(target)) {
		return findInteractionElementInEvent(target);
	}

	return (
		findClosestComposed(target, CARD_INTERACTION_SELECTOR) ??
		findClosestComposed(target, INTERACTION_SELECTOR)
	);
}

function findInteractionElementInEvent(event: Event): HTMLElement | null {
	let cardMatch: HTMLElement | null = null;
	let interactionMatch: HTMLElement | null = null;

	for (const entry of event.composedPath()) {
		if (!isElementLike(entry)) {
			continue;
		}

		if (!cardMatch) {
			const match = entry.matches(CARD_INTERACTION_SELECTOR)
				? entry
				: entry.closest(CARD_INTERACTION_SELECTOR);
			if (isHTMLElementLike(match)) {
				cardMatch = match;
			}
		}

		if (!interactionMatch) {
			const match = entry.matches(INTERACTION_SELECTOR)
				? entry
				: entry.closest(INTERACTION_SELECTOR);
			if (isHTMLElementLike(match)) {
				interactionMatch = match;
			}
		}

		if (cardMatch && interactionMatch) {
			break;
		}
	}

	return (
		cardMatch ??
		interactionMatch ??
		findClosestComposed(event.target, CARD_INTERACTION_SELECTOR) ??
		findClosestComposed(event.target, INTERACTION_SELECTOR)
	);
}

export function getAttachedInteractionHoverTarget(event: Event): HTMLElement | null {
	return getInteractionElement(event);
}

export function getInteractionIdFromElement(
	element: HTMLElement | null,
): string | null {
	return element?.dataset.cclInteractionId ?? null;
}

export function markInteractionLongPressed(element: HTMLElement): void {
	element.dataset.cclLongPressed = "1";
}

export function clearInteractionLongPressed(element: HTMLElement): void {
	delete element.dataset.cclLongPressed;
}

export function markInteractionTouched(
	element: HTMLElement,
	timestamp = Date.now(),
): void {
	element.dataset[LAST_TOUCH_AT_DATASET_KEY] = String(timestamp);
}

export function getInteractionLastTouchAt(element: HTMLElement): number | null {
	const raw = element.dataset[LAST_TOUCH_AT_DATASET_KEY];
	if (!raw) {
		return null;
	}

	const timestamp = Number(raw);
	return Number.isFinite(timestamp) ? timestamp : null;
}

export function consumeInteractionLongPressed(
	element: HTMLElement,
	event: MouseEvent | KeyboardEvent,
): boolean {
	if (element.dataset.cclLongPressed !== "1") {
		return false;
	}

	event.preventDefault();
	event.stopPropagation();
	clearInteractionLongPressed(element);
	return true;
}

export function dispatchSyntheticMouseOver(
	element: HTMLElement,
	coords?: MouseEventInit,
): void {
	const event = createOwnerMouseEvent(element, "mouseover", {
		bubbles: true,
		cancelable: true,
		composed: true,
		...(coords ?? {}),
	});

	Object.defineProperty(event, SYNTHETIC_HOVER_EVENT_FLAG, {
		value: true,
		configurable: true,
	});

	element.dispatchEvent(event);
}

export function isSyntheticInteractionHoverEvent(event: MouseEvent): boolean {
	return (
		(
			event as MouseEvent & {
				[SYNTHETIC_HOVER_EVENT_FLAG]?: unknown;
			}
		)[SYNTHETIC_HOVER_EVENT_FLAG] === true
	);
}
