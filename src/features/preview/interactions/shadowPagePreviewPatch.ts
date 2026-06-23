import type { App } from "obsidian";
import { getAttachedInteractionHoverTarget } from "ui/interactions/interactionTypes";
import { ObsidianInternalFacade } from "infrastructure/capabilities/ObsidianInternalFacade";
import {
	isEventLike,
	isHTMLElementLike,
	isShadowRootLike,
} from "ui/utils/realmSafeDom";

const PAGE_PREVIEW_SHADOW_PATCH_FLAG = "__cclShadowHoverPatched";

interface PatchedPagePreviewInstance {
	onLinkHover?: (...args: unknown[]) => unknown;
	[PAGE_PREVIEW_SHADOW_PATCH_FLAG]?: boolean;
}

function isPagePreviewPatched(
	instance: PatchedPagePreviewInstance | undefined,
): boolean {
	return instance?.[PAGE_PREVIEW_SHADOW_PATCH_FLAG] === true;
}

function findEventArgument(args: unknown[]): Event | undefined {
	return args.find(isEventLike);
}

function normalizeShadowPopoverTarget(
	targetEl: unknown,
	event?: Event,
): HTMLElement | undefined {
	const annotated = event ? getAttachedInteractionHoverTarget(event) : null;
	if (annotated) {
		return annotated;
	}

	if (!isHTMLElementLike(targetEl)) {
		return undefined;
	}

	const root = targetEl.getRootNode?.();
	if (!isShadowRootLike(root)) {
		return targetEl;
	}

	for (const entry of event?.composedPath?.() ?? []) {
		if (!isHTMLElementLike(entry)) {
			continue;
		}
		if (!root.contains(entry)) {
			continue;
		}

		const stableTarget = entry.closest<HTMLElement>(
			"[data-ccl-interaction-id], .cosense-card-links__box, .internal-link",
		);
		if (stableTarget) {
			return stableTarget;
		}
	}

	return (
		targetEl.closest<HTMLElement>(
			"[data-ccl-interaction-id], .cosense-card-links__box, .internal-link",
		) ?? targetEl
	);
}

export function ensurePagePreviewShadowPatch(app: App): void {
	const capability = new ObsidianInternalFacade(app).getPagePreviewOnLinkHover();
	if (!capability.ok) {
		return;
	}
	const instance = capability.value.instance as PatchedPagePreviewInstance;
	if (isPagePreviewPatched(instance)) {
		return;
	}

	const originalOnLinkHover = capability.value.onLinkHover;
	instance.onLinkHover = function patchedOnLinkHover(
		this: unknown,
		parent: unknown,
		targetEl: unknown,
		linktext: unknown,
		sourcePath: unknown,
		state: unknown,
		...rest: unknown[]
	) {
		const event = findEventArgument(rest);
		const normalizedTarget =
			normalizeShadowPopoverTarget(targetEl, event) ??
			(isHTMLElementLike(targetEl) ? targetEl : undefined);

		return originalOnLinkHover.call(
			this,
			parent,
			normalizedTarget ?? null,
			typeof linktext === "string" ? linktext : String(linktext ?? ""),
			typeof sourcePath === "string" ? sourcePath : String(sourcePath ?? ""),
			state,
			...rest,
		);
	};
	instance[PAGE_PREVIEW_SHADOW_PATCH_FLAG] = true;
}
