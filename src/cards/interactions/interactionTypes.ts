import type { TFile } from "obsidian";
import { getItemRawText, getItemTargetFile, type CardItem } from "cards/CardItem";
import {
	generateBacklinkKey,
	generateBranchKey,
	generateIndexedLinkKey,
} from "preview/text/textUtils";
import type {
	AppContext,
	LinkInteractionOptions,
	LinkUtilitiesContext,
} from "cards/context/linkContext";
import type { IndexedLink } from "indexing/model";
import type { PluginSettings } from "settings/model";
import { findClosestComposed } from "shared/ui/dom/shadowDom";
import {
	createOwnerMouseEvent,
	isElementLike,
	isEventLike,
	isHTMLElementLike,
} from "shared/ui/dom/realmSafeDom";

export const INTERACTION_ID_ATTRIBUTE = "data-ccl-interaction-id";
export const LONG_PRESSED_ATTRIBUTE = "data-ccl-long-pressed";
export const INTERACTION_SELECTOR = `[${INTERACTION_ID_ATTRIBUTE}]`;
const CARD_INTERACTION_SELECTOR = `.cosense-card-links__box${INTERACTION_SELECTOR}`;
const SYNTHETIC_HOVER_EVENT_FLAG = "__cclSyntheticHover";
const LAST_TOUCH_AT_DATASET_KEY = "cclLastTouchAt";

export type InteractionKind = "item" | "sectionHeader";

/** Settings read by delegated card and section-header interactions. */
export type InteractionSettings = Pick<
	PluginSettings,
	"highlightInPreviewOnHover" | "mobileLongPressAction"
>;

interface BaseInteractionDescriptor {
	interactionId: string;
	kind: InteractionKind;
	targetFile: TFile | null;
	hoverPreviewEnabled?: boolean;
	dragRawText?: string;
	filePathForDrag?: string;
	settings?: InteractionSettings;
	searchQuery?: string;
}

export interface ItemInteractionDescriptor extends BaseInteractionDescriptor {
	kind: "item";
	item: CardItem;
}

export interface SectionHeaderInteractionDescriptor extends BaseInteractionDescriptor {
	kind: "sectionHeader";
	link: IndexedLink;
	isOutgoingLink: boolean;
}

export type InteractionDescriptor =
	| ItemInteractionDescriptor
	| SectionHeaderInteractionDescriptor;

export function createItemInteractionKey(item: CardItem, virtualKey?: string): string {
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
}

export function createItemInteractionDescriptor(
	item: CardItem,
	settings: PluginSettings,
	searchQuery: string,
	context: LinkUtilitiesContext,
	options: CreateItemInteractionDescriptorOptions = {},
): ItemInteractionDescriptor | null {
	const interactionId = options.interactionId ?? createItemInteractionKey(item);
	const targetFile = getItemTargetFile(item, context);
	const rawText = getItemRawText(item);

	return {
		interactionId,
		kind: "item",
		item,
		targetFile,
		hoverPreviewEnabled: item.type !== "newLink" && !!targetFile,
		dragRawText: rawText,
		filePathForDrag: targetFile?.path,
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
	const resolution = resolveSearchPositionRequest(descriptor, appContext);
	if (resolution.type !== "resolved") {
		return { highlightMode: resolution.type === "none" ? "auto" : "suppress" };
	}

	return {
		highlightMode: "force",
		preferredPosition: resolution.position,
	};
}

/** Resolves an offset-backed search position only when an interaction needs it. */
export function resolveDescriptorInteractionOptionsAsync(
	descriptor: InteractionDescriptor,
	appContext: AppContext | undefined,
): LinkInteractionOptions | Promise<LinkInteractionOptions> {
	const resolution = resolveSearchPositionRequest(descriptor, appContext);
	if (resolution.type === "none") return { highlightMode: "auto" };
	if (resolution.type === "missing") return { highlightMode: "suppress" };
	if (resolution.type === "resolved") {
		return { highlightMode: "force", preferredPosition: resolution.position };
	}

	return resolution.position.then((position) =>
		position
			? { highlightMode: "force", preferredPosition: position }
			: { highlightMode: "suppress" },
	);
}

type SearchPositionResolution =
	| { readonly type: "none" }
	| { readonly type: "missing" }
	| {
			readonly type: "resolved";
			readonly position: NonNullable<LinkInteractionOptions["preferredPosition"]>;
	  }
	| {
			readonly type: "pending";
			readonly position: Promise<
				NonNullable<LinkInteractionOptions["preferredPosition"]> | undefined
			>;
	  };

function resolveSearchPositionRequest(
	descriptor: InteractionDescriptor,
	appContext: AppContext | undefined,
): SearchPositionResolution {
	const normalizedSearchQuery = descriptor.searchQuery?.trim().toLowerCase() ?? "";

	if (!normalizedSearchQuery) {
		return { type: "none" };
	}

	if (!descriptor.targetFile) {
		return { type: "missing" };
	}

	const preferredPosition = appContext?.resolveSearchMatchPosition?.(
		normalizedSearchQuery,
		descriptor.targetFile,
	);

	if (!preferredPosition) {
		return { type: "missing" };
	}
	if (isPromiseLike(preferredPosition)) {
		return { type: "pending", position: preferredPosition };
	}
	return { type: "resolved", position: preferredPosition };
}

export function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
	return (
		typeof value === "object" &&
		value !== null &&
		"then" in value &&
		typeof value.then === "function"
	);
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
	if (!element) {
		return null;
	}

	return element.dataset.cclInteractionId ?? null;
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
