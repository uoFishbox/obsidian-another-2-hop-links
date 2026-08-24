import {
	createOwnerMouseEvent,
	getOwnerWindow,
	isHTMLElementLike,
} from "ui/shared/dom/realmSafeDom";
import type { ShadowHoverSession } from "./internal-types";
import {
	beginSessionHandoff,
	beginSessionRequest,
	clearPendingHandoffTimer,
	createShadowHoverSession,
	destroySessionState,
	expirePendingPopoverHandoff,
	getActiveSessionAnchor,
	getActiveSessionHoverParent,
	getActiveSessionPopover,
	getActualForProxy,
	getBoundPopoverActualAnchor,
	getBoundPopoverAnchor,
	isActualHovered,
	nextSessionRequestSeq,
	relayHoverToProxy,
	releasePopoverToNativeLifecycle,
	setAnchorHovered,
	syncPopoverTargetAndTransition,
	syncProxyRectForActual,
	syncSessionAnchor,
} from "./session";

export type ShadowPopoverLaunchRequest = {
	session: ShadowHoverSession;
	actualAnchorEl: HTMLElement;
	proxyAnchorEl: HTMLElement;
	event: MouseEvent;
	link: ShadowHoverLinkSpec;
	requestSeq: number;
};

type ShadowHoverLinkSpec = {
	linktext: string;
	sourcePath: string;
	state?: unknown;
};

type LaunchShadowPopover = (request: ShadowPopoverLaunchRequest) => void;
type ResolveShadowHoverLink = (interactionId: string) => ShadowHoverLinkSpec | null;

export class ShadowHoverControllerImpl {
	private static readonly RECOVERY_RELAUNCH_DELAY_MS = 650;

	private readonly session = createShadowHoverSession();
	private lastLaunchActualEl: HTMLElement | null = null;
	private lastLaunchInteractionId: string | null = null;
	private lastLaunchAt = 0;

	constructor(
		private readonly launchPopover: LaunchShadowPopover,
		private readonly resolveLink: ResolveShadowHoverLink,
	) {}

	handleDelegatedEnter(
		anchorEl: HTMLElement,
		interactionId: string,
		event: MouseEvent,
	): void {
		if (this.session.destroyed) return;
		setAnchorHovered(this.session, anchorEl, true);
		this.handleAnchorEnter(anchorEl, interactionId, event);
	}

	handleDelegatedAnchorSync(
		anchorEl: HTMLElement,
		interactionId?: string,
		event?: MouseEvent,
	): void {
		if (this.session.destroyed) return;

		const previousAnchorEl = this.session.activeAnchor?.actualEl;
		const wasHovered = isActualHovered(this.session, anchorEl);
		if (previousAnchorEl && previousAnchorEl !== anchorEl) {
			const wasPreviousHovered = isActualHovered(this.session, previousAnchorEl);
			setAnchorHovered(this.session, previousAnchorEl, false);
			if (wasPreviousHovered)
				relayHoverToProxy(this.session, previousAnchorEl, false);
			if (this.session.activePopover) {
				releasePopoverToNativeLifecycle(
					this.session.activePopover,
					this.session,
				);
			}
		}

		setAnchorHovered(this.session, anchorEl, true);
		this.syncActiveAnchor(anchorEl);
		if (!wasHovered || previousAnchorEl !== anchorEl) {
			relayHoverToProxy(this.session, anchorEl, true);
		}
		syncPopoverTargetAndTransition(this.session);
		if (
			interactionId &&
			this.shouldRecoverMissingPopover(anchorEl, interactionId)
		) {
			this.relaunchAnchor(anchorEl, interactionId, event);
		}
	}

	handleDelegatedModifierKey(
		anchorEl: HTMLElement,
		interactionId: string,
		event: KeyboardEvent,
	): void {
		if (this.session.destroyed) return;
		setAnchorHovered(this.session, anchorEl, true);
		this.relaunchAnchor(anchorEl, interactionId);
	}

	handleDelegatedPointerMove(
		anchorEl: HTMLElement,
		interactionId: string,
		event: PointerEvent,
	): void {
		if (this.session.destroyed) return;
		setAnchorHovered(this.session, anchorEl, true);

		if (this.session.activeAnchor?.actualEl !== anchorEl) {
			this.handleAnchorEnter(anchorEl, interactionId, event);
			return;
		}
		this.relaunchAnchor(anchorEl, interactionId, event);
	}

	handleDelegatedLeave(anchorEl: HTMLElement): void {
		if (this.session.destroyed) return;
		const wasHovered = isActualHovered(this.session, anchorEl);
		setAnchorHovered(this.session, anchorEl, false);
		if (this.session.activeAnchor?.actualEl !== anchorEl) return;

		if (wasHovered) relayHoverToProxy(this.session, anchorEl, false);
		this.session.overAnchor = false;
		syncPopoverTargetAndTransition(this.session);
	}

	releaseActivePopover(): void {
		if (this.session.destroyed || !this.session.activePopover) return;
		releasePopoverToNativeLifecycle(this.session.activePopover, this.session);
	}

	destroy(): void {
		if (this.session.destroyed) return;
		clearPendingHandoffTimer(this.session);
		if (this.session.activePopover) {
			releasePopoverToNativeLifecycle(this.session.activePopover, this.session);
		}
		this.session.teardownPopoverListeners?.();
		this.session.teardownPopoverListeners = null;
		destroySessionState(this.session);
	}

	private shouldRecoverMissingPopover(
		anchorEl: HTMLElement,
		interactionId: string,
	): boolean {
		if (this.session.activePopover) return false;
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
		const proxy = syncProxyRectForActual(this.session, anchorEl);
		syncSessionAnchor(this.session, anchorEl, proxy);
		this.session.overAnchor = isActualHovered(this.session, anchorEl);
		return proxy;
	}

	private relaunchAnchor(
		anchorEl: HTMLElement,
		interactionId: string,
		event?: MouseEvent,
	): void {
		const proxy = this.syncActiveAnchor(anchorEl);
		const link = this.resolveLink(interactionId);
		if (!link) {
			return;
		}
		syncPopoverTargetAndTransition(this.session);
		const requestSeq = nextSessionRequestSeq(this.session);
		beginSessionRequest(
			this.session,
			{ actualEl: anchorEl, proxyEl: proxy },
			requestSeq,
		);
		this.markLaunch(anchorEl, interactionId);
		this.launchPopover({
			session: this.session,
			actualAnchorEl: anchorEl,
			proxyAnchorEl: proxy,
			event: event ?? this.createSyntheticHoverEvent(anchorEl),
			link,
			requestSeq,
		});
	}

	private handleAnchorEnter(
		anchorEl: HTMLElement,
		interactionId: string,
		mouseEvent?: MouseEvent,
	): void {
		if (this.session.destroyed) return;

		const requestSeq = nextSessionRequestSeq(this.session);
		const currentPopover = getActiveSessionPopover(this.session);
		const previousSessionAnchor = getActiveSessionAnchor(this.session);
		const currentAnchor = currentPopover
			? (getBoundPopoverActualAnchor(currentPopover) ??
				getBoundPopoverAnchor(currentPopover))
			: null;
		const previousActualAnchor = isHTMLElementLike(currentAnchor)
			? (getActualForProxy(this.session, currentAnchor) ?? currentAnchor)
			: previousSessionAnchor?.actualEl;
		const previousProxyAnchor = currentPopover
			? getBoundPopoverAnchor(currentPopover)
			: previousSessionAnchor?.proxyEl;
		const wantsPreview = mouseEvent
			? Boolean(mouseEvent.ctrlKey || mouseEvent.metaKey)
			: true;
		const proxy = this.syncActiveAnchor(anchorEl);
		relayHoverToProxy(this.session, anchorEl, true);

		if (
			currentPopover &&
			previousActualAnchor &&
			previousActualAnchor !== anchorEl &&
			wantsPreview
		) {
			clearPendingHandoffTimer(this.session);
			beginSessionHandoff(this.session, {
				fromPopover: currentPopover,
				fromHoverParent: getActiveSessionHoverParent(this.session),
				fromAnchor: {
					actualEl: previousActualAnchor,
					proxyEl:
						previousProxyAnchor ??
						syncProxyRectForActual(this.session, previousActualAnchor),
				},
				toAnchor: { actualEl: anchorEl, proxyEl: proxy },
				requestSeq,
			});
			const ownerWindow = getOwnerWindow(anchorEl);
			this.session.handoffTimerWindow = ownerWindow;
			this.session.handoffTimer = ownerWindow.setTimeout(() => {
				const handoff = expirePendingPopoverHandoff(this.session, requestSeq);
				if (handoff) {
					releasePopoverToNativeLifecycle(handoff.fromPopover, this.session);
				}
			}, 600);
		} else {
			beginSessionRequest(
				this.session,
				{ actualEl: anchorEl, proxyEl: proxy },
				requestSeq,
			);
		}

		const link = this.resolveLink(interactionId);
		if (!link) {
			syncPopoverTargetAndTransition(this.session);
			return;
		}
		syncPopoverTargetAndTransition(this.session);
		this.markLaunch(anchorEl, interactionId);
		this.launchPopover({
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
}
