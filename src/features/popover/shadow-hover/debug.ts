import { enableLogging, logger } from "shared/logging/logger";
import type {
	DebugLogEntry,
	HoverPopoverLike,
	ShadowHoverSession,
} from "./internal-types";
import { getSessionAnchor, getSessionPopover } from "./state-machine";

const MAX_DEBUG_LOGS = 200;

export function summarizePopover(
	popover: HoverPopoverLike | null | undefined,
): Record<string, unknown> | null {
	if (!popover) {
		return null;
	}

	return {
		state: popover.state ?? null,
		onTarget: popover.onTarget ?? null,
		onHover: popover.onHover ?? null,
		isFocused: popover.isFocused ?? null,
		timer: popover.timer ?? null,
		targetTag: popover.targetEl?.tagName ?? null,
		targetClass: popover.targetEl?.className ?? null,
		hoverElClass: popover.hoverEl?.className ?? null,
		hasHide: typeof popover.hide === "function",
		hasClose: typeof popover.close === "function",
		hasUnload: typeof popover.unload === "function",
	};
}

export function summarizeSession(session: ShadowHoverSession): Record<string, unknown> {
	const activeAnchor = getSessionAnchor(session.state);
	const popover = getSessionPopover(session.state);
	const handoff = session.state.type === "handoff" ? session.state : null;
	return {
		lifecycle: session.state.type,
		overAnchor: session.interaction.overAnchor,
		overPopover: session.interaction.overPopover,
		destroyed: session.state.type === "destroyed",
		activeAnchorTag: activeAnchor?.proxyEl.tagName ?? null,
		activeAnchorClass: activeAnchor?.proxyEl.className ?? null,
		activeActualTag: activeAnchor?.actualEl.tagName ?? null,
		activeActualClass: activeAnchor?.actualEl.className ?? null,
		popover: summarizePopover(popover),
		lastHoverPath: session.lastHoverPath,
		hoverRequestSeq: session.state.requestSeq,
		pendingHandoff: handoff
			? {
					requestSeq: handoff.requestSeq,
					fromPopover: summarizePopover(handoff.from.popover),
					fromActualClass: handoff.from.anchor.actualEl.className,
					toActualClass: handoff.to.actualEl.className,
					timerActive: session.handoffTimer != null,
				}
			: null,
	};
}

export function debugLog(
	session: ShadowHoverSession,
	type: string,
	message: string,
	detail?: unknown | (() => unknown),
): void {
	if (!enableLogging) {
		return;
	}
	if (!session || typeof session !== "object") {
		return;
	}
	if (typeof session.logSeq !== "number" || !Array.isArray(session.logs)) {
		return;
	}
	const resolvedDetail = typeof detail === "function" ? detail() : detail;
	const entry: DebugLogEntry = {
		index: session.logSeq++,
		at: Date.now(),
		type,
		message,
		detail: resolvedDetail,
	};
	session.logs.push(entry);
	if (session.logs.length > MAX_DEBUG_LOGS) {
		session.logs.splice(0, session.logs.length - MAX_DEBUG_LOGS);
	}
	if (enableLogging) logger(`[ShadowHover][${type}] ${message}`, resolvedDetail);
}
