import { debugLog, summarizeSession } from "./debug";
import { rectToObject } from "./dom-utils";
import type { HoverPopoverLike, ShadowHoverSession } from "./internal-types";
import type { ShadowPopoverLauncher } from "./launcher";
import type { ShadowHoverController, ShadowHoverLinkResolver } from "./public-types";
import { ShadowAnchorRegistry } from "./registry";
import {
	clearPendingHandoffTimer,
	createShadowHoverSession,
	expirePendingPopoverHandoff,
	getActiveSessionAnchor,
	getActiveSessionPopover,
	getBoundPopoverActualAnchor,
	getBoundPopoverAnchor,
	isSessionDestroyed,
	nextSessionRequestSeq,
	releasePopoverToNativeLifecycle,
	syncSessionAnchor,
	syncPopoverTargetAndTransition,
	transitionSession,
	transitionSessionInteraction,
} from "./session";
import { getSessionOpenPopover } from "./state-machine";
import {
	createOwnerMouseEvent,
	getOwnerWindow,
	isHTMLElementLike,
} from "ui/shared/dom/realmSafeDom";
import { enableLogging } from "shared/logging/logger";

export class ShadowHoverControllerImpl implements ShadowHoverController {
	private static readonly RECOVERY_RELAUNCH_DELAY_MS = 650;

	private readonly session = createShadowHoverSession(new ShadowAnchorRegistry());
	private lastPointerModState: boolean | null = null;
	private lastLaunchActualEl: HTMLElement | null = null;
	private lastLaunchInteractionId: string | null = null;
	private lastLaunchAt = 0;

	constructor(
		private readonly launcher: ShadowPopoverLauncher,
		private readonly resolveLink: ShadowHoverLinkResolver,
	) {}

	handleDelegatedEnter(
		anchorEl: HTMLElement,
		interactionId: string,
		event: MouseEvent,
	): void {
		if (isSessionDestroyed(this.session)) {
			return;
		}

		this.session.anchorRegistry.setHovered(anchorEl, true);
		this.lastPointerModState = this.getPointerModState(event);
		void this.handleAnchorEnter(anchorEl, interactionId, event);
	}

	handleDelegatedAnchorSync(
		anchorEl: HTMLElement,
		interactionId?: string,
		event?: MouseEvent,
	): void {
		if (isSessionDestroyed(this.session)) {
			return;
		}

		const previousAnchorEl = getActiveSessionAnchor(this.session)?.actualEl;
		const wasHovered = this.session.anchorRegistry.isActualHovered(anchorEl);
		if (previousAnchorEl && previousAnchorEl !== anchorEl) {
			const wasPreviousHovered =
				this.session.anchorRegistry.isActualHovered(previousAnchorEl);
			this.session.anchorRegistry.setHovered(previousAnchorEl, false);
			if (wasPreviousHovered) {
				this.session.anchorRegistry.relayHoverToProxy(previousAnchorEl, false);
			}
			const previousPopover = getActiveSessionPopover(this.session);
			if (previousPopover) {
				releasePopoverToNativeLifecycle(
					previousPopover,
					this.session,
					"anchor-rebind",
				);
			}
		}
		this.session.anchorRegistry.setHovered(anchorEl, true);
		this.syncActiveAnchor(anchorEl);
		if (!wasHovered || previousAnchorEl !== anchorEl) {
			this.session.anchorRegistry.relayHoverToProxy(anchorEl, true);
		}
		syncPopoverTargetAndTransition(this.session, "anchor-sync");
		if (
			interactionId &&
			this.shouldRecoverMissingPopover(anchorEl, interactionId)
		) {
			this.relaunchAnchor(
				anchorEl,
				interactionId,
				"anchor-sync-recover",
				undefined,
				event,
			);
		}
	}

	handleDelegatedModifierKey(
		anchorEl: HTMLElement,
		interactionId: string,
		event: KeyboardEvent,
	): void {
		if (isSessionDestroyed(this.session)) {
			return;
		}

		this.session.anchorRegistry.setHovered(anchorEl, true);
		this.lastPointerModState = this.getPointerModState(event);
		this.relaunchAnchor(
			anchorEl,
			interactionId,
			"anchor-modifier-key",
			enableLogging
				? {
						key: event.key,
						modState: this.lastPointerModState,
					}
				: undefined,
		);
	}

	handleDelegatedPointerMove(
		anchorEl: HTMLElement,
		interactionId: string,
		event: PointerEvent,
	): void {
		if (isSessionDestroyed(this.session)) {
			return;
		}

		this.session.anchorRegistry.setHovered(anchorEl, true);
		this.handleAnchorPointerMove(anchorEl, interactionId, event);
	}

	handleDelegatedLeave(anchorEl: HTMLElement): void {
		if (isSessionDestroyed(this.session)) {
			return;
		}

		const wasHovered = this.session.anchorRegistry.isActualHovered(anchorEl);
		this.session.anchorRegistry.setHovered(anchorEl, false);
		if (getActiveSessionAnchor(this.session)?.actualEl === anchorEl) {
			if (wasHovered) {
				this.session.anchorRegistry.relayHoverToProxy(anchorEl, false);
			}
			transitionSessionInteraction(this.session, {
				type: "anchor-hover-sync",
				overAnchor: false,
			});
			this.lastPointerModState = null;
			if (enableLogging) {
				debugLog(this.session, "anchor-leave", "Anchor left", () =>
					this.describeAnchor(anchorEl),
				);
			}
			syncPopoverTargetAndTransition(this.session, "anchor-leave");
		}
	}

	releaseActivePopover(): void {
		if (isSessionDestroyed(this.session)) {
			return;
		}

		const popover = getActiveSessionPopover(this.session);
		if (!popover) {
			return;
		}
		releasePopoverToNativeLifecycle(popover, this.session, "bridge-release");
	}

	syncActivePopover(): void {
		if (isSessionDestroyed(this.session)) {
			return;
		}

		if (enableLogging) {
			debugLog(this.session, "debug-sync", "Manual sync requested", () =>
				summarizeSession(this.session),
			);
		}
		syncPopoverTargetAndTransition(this.session, "debug-sync");
	}

	destroy(): void {
		if (isSessionDestroyed(this.session)) {
			return;
		}

		this.teardownSession();
	}

	getDebugSession(): ShadowHoverSession {
		return this.session;
	}

	getDebugPopover(): HoverPopoverLike | null {
		return getActiveSessionPopover(this.session);
	}

	private hasLivePopover(): boolean {
		return Boolean(getActiveSessionPopover(this.session));
	}

	private shouldRecoverMissingPopover(
		anchorEl: HTMLElement,
		interactionId: string,
	): boolean {
		if (this.hasLivePopover()) {
			return false;
		}
		if (
			this.lastLaunchActualEl !== anchorEl ||
			this.lastLaunchInteractionId !== interactionId
		) {
			return true;
		}
		return (
			Date.now() - this.lastLaunchAt >=
			ShadowHoverControllerImpl.RECOVERY_RELAUNCH_DELAY_MS
		);
	}

	private markLaunch(anchorEl: HTMLElement, interactionId: string): void {
		this.lastLaunchActualEl = anchorEl;
		this.lastLaunchInteractionId = interactionId;
		this.lastLaunchAt = Date.now();
	}

	private syncActiveAnchor(anchorEl: HTMLElement): HTMLElement {
		const proxy = this.session.anchorRegistry.syncProxyRectForActual(anchorEl);
		syncSessionAnchor(this.session, anchorEl, proxy);
		transitionSessionInteraction(this.session, {
			type: "anchor-hover-sync",
			overAnchor: this.session.anchorRegistry.isHovered(proxy),
		});
		return proxy;
	}

	private getPointerModState(
		evt: MouseEvent | PointerEvent | KeyboardEvent,
	): boolean {
		return Boolean(evt.ctrlKey || evt.metaKey);
	}

	private handleAnchorPointerMove(
		anchorEl: HTMLElement,
		interactionId: string,
		evt: PointerEvent,
	): void {
		const previouslyActiveActual = getActiveSessionAnchor(this.session)?.actualEl;
		if (previouslyActiveActual !== anchorEl) {
			this.lastPointerModState = this.getPointerModState(evt);
			void this.handleAnchorEnter(anchorEl, interactionId, evt);
			return;
		}

		const previousModState = this.lastPointerModState;
		const modState = this.getPointerModState(evt);
		this.lastPointerModState = modState;
		const shouldRetrigger = modState && !previousModState;
		if (!shouldRetrigger) {
			return;
		}

		this.relaunchAnchor(
			anchorEl,
			interactionId,
			"anchor-pointermove",
			enableLogging ? { modState, previousModState } : undefined,
			evt,
		);
	}

	private relaunchAnchor(
		anchorEl: HTMLElement,
		interactionId: string,
		reason: string,
		details: Record<string, unknown> | undefined,
		event?: MouseEvent,
	): void {
		const proxy = this.syncActiveAnchor(anchorEl);
		const link = this.resolveLink(interactionId);
		if (!link) {
			if (enableLogging) {
				debugLog(
					this.session,
					`${reason}-skip`,
					`Retrigger skipped because link resolver returned null (${reason})`,
					() => this.describeAnchor(anchorEl),
				);
			}
			return;
		}

		if (enableLogging) {
			debugLog(this.session, reason, `Retrigger (${reason})`, () => ({
				linktext: link.linktext,
				rect: rectToObject(anchorEl.getBoundingClientRect()),
				...details,
			}));
		}
		syncPopoverTargetAndTransition(this.session, `${reason}-retrigger`);
		const requestSeq = nextSessionRequestSeq(this.session);
		transitionSession(this.session, {
			type: "request-open",
			anchor: { actualEl: anchorEl, proxyEl: proxy },
			requestSeq,
		});
		this.markLaunch(anchorEl, interactionId);
		this.launcher.launch({
			session: this.session,
			actualAnchorEl: anchorEl,
			proxyAnchorEl: proxy,
			event: event ?? this.createSyntheticHoverEvent(anchorEl),
			link,
			requestSeq,
		});
	}

	private async handleAnchorEnter(
		anchorEl: HTMLElement,
		interactionId: string,
		mouseEvent?: MouseEvent,
	): Promise<void> {
		if (isSessionDestroyed(this.session)) {
			return;
		}

		const requestSeq = nextSessionRequestSeq(this.session);
		const currentPopover = getActiveSessionPopover(this.session);
		const currentOpenPopover = getSessionOpenPopover(this.session.state);
		const previousSessionAnchor = getActiveSessionAnchor(this.session);
		const currentAnchor = currentPopover
			? (getBoundPopoverActualAnchor(currentPopover) ??
				getBoundPopoverAnchor(currentPopover))
			: null;
		const previousActualAnchor = isHTMLElementLike(currentAnchor)
			? (this.session.anchorRegistry.getActual(currentAnchor) ?? currentAnchor)
			: previousSessionAnchor?.actualEl;
		const previousProxyAnchor = currentPopover
			? getBoundPopoverAnchor(currentPopover)
			: previousSessionAnchor?.proxyEl;
		const previousAnchorRect =
			enableLogging && previousActualAnchor
				? rectToObject(previousActualAnchor.getBoundingClientRect())
				: null;
		const wantsPreview = mouseEvent ? this.getPointerModState(mouseEvent) : true;
		const proxy = this.syncActiveAnchor(anchorEl);
		this.session.anchorRegistry.relayHoverToProxy(anchorEl, true);
		if (
			currentPopover &&
			previousActualAnchor &&
			previousActualAnchor !== anchorEl &&
			wantsPreview
		) {
			if (enableLogging) {
				debugLog(
					this.session,
					"handoff-start",
					"Keeping previous popover until replacement is assigned",
					() => ({
						requestSeq,
						previousAnchorRect,
						newAnchorRect: rectToObject(proxy.getBoundingClientRect()),
					}),
				);
			}
			clearPendingHandoffTimer(this.session);
			transitionSession(this.session, {
				type: "handoff-start",
				fromPopover: currentPopover,
				fromHoverParent: currentOpenPopover?.hoverParent ?? null,
				fromAnchor: {
					actualEl: previousActualAnchor,
					proxyEl:
						previousProxyAnchor ??
						this.session.anchorRegistry.syncProxyRectForActual(
							previousActualAnchor,
						),
				},
				toAnchor: { actualEl: anchorEl, proxyEl: proxy },
				requestSeq,
			});
			const ownerWindow = getOwnerWindow(anchorEl);
			this.session.handoffTimerWindow = ownerWindow;
			this.session.handoffTimer = ownerWindow.setTimeout(() => {
				const handoff = expirePendingPopoverHandoff(this.session, requestSeq);
				if (!handoff) {
					return;
				}
				releasePopoverToNativeLifecycle(
					handoff.fromPopover,
					this.session,
					"handoff-timeout",
				);
			}, 600);
		} else {
			transitionSession(this.session, {
				type: "request-open",
				anchor: { actualEl: anchorEl, proxyEl: proxy },
				requestSeq,
			});
		}

		const link = this.resolveLink(interactionId);
		if (!link) {
			transitionSession(this.session, {
				type: "request-cancel",
				requestSeq,
			});
			this.session.lastHoverPath = "link-resolver-null";
			if (enableLogging) {
				debugLog(
					this.session,
					"anchor-enter-skip",
					"Anchor entered but link resolver returned null",
					() => this.describeAnchor(anchorEl),
				);
			}
			syncPopoverTargetAndTransition(this.session, "anchor-enter-no-link");
			return;
		}

		if (enableLogging) {
			debugLog(
				this.session,
				"anchor-enter",
				`Anchor entered: ${link.linktext}`,
				() => ({
					linktext: link.linktext,
					sourcePath: link.sourcePath,
					rect: rectToObject(anchorEl.getBoundingClientRect()),
					proxyRect: rectToObject(proxy.getBoundingClientRect()),
					className: anchorEl.className,
				}),
			);
		}
		syncPopoverTargetAndTransition(this.session, "anchor-enter");
		this.markLaunch(anchorEl, interactionId);
		this.launcher.launch({
			session: this.session,
			actualAnchorEl: anchorEl,
			proxyAnchorEl: proxy,
			event: mouseEvent ?? this.createSyntheticHoverEvent(anchorEl),
			link,
			requestSeq,
		});
	}

	private createSyntheticHoverEvent(targetEl: HTMLElement): MouseEvent {
		const rect = targetEl.getBoundingClientRect();
		return createOwnerMouseEvent(targetEl, "mouseover", {
			bubbles: true,
			cancelable: true,
			composed: true,
			clientX: rect.left + rect.width / 2,
			clientY: rect.top + rect.height / 2,
		});
	}

	private describeAnchor(anchorEl: HTMLElement): Record<string, unknown> {
		return {
			className: anchorEl.className,
			rect: rectToObject(anchorEl.getBoundingClientRect()),
		};
	}

	private teardownSession(): void {
		if (enableLogging) {
			debugLog(this.session, "session-teardown", "Tearing down session", () =>
				summarizeSession(this.session),
			);
		}
		clearPendingHandoffTimer(this.session);
		const popover = getActiveSessionPopover(this.session);
		if (popover) {
			releasePopoverToNativeLifecycle(popover, this.session, "destroy");
		}
		transitionSession(this.session, { type: "destroy" });
		this.session.teardownPopoverListeners?.();
		this.session.teardownPopoverListeners = null;
		this.session.anchorRegistry.destroy();
	}
}

function getShadowHoverControllerDebugState(
	controller: ShadowHoverController,
): ShadowHoverSession | null {
	return controller instanceof ShadowHoverControllerImpl
		? controller.getDebugSession()
		: null;
}

export function getShadowHoverControllerDebugPopover(
	controller: ShadowHoverController,
): HoverPopoverLike | null {
	return controller instanceof ShadowHoverControllerImpl
		? controller.getDebugPopover()
		: null;
}
