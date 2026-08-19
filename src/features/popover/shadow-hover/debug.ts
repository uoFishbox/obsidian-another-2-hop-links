import { enableLogging, logger } from "shared/logging/logger";
import { isElementLike, isNodeLike } from "ui/shared/dom/realmSafeDom";
import type {
	DebugLogEntry,
	HoverPopoverLike,
	ShadowHoverSession,
} from "./internal-types";

const MAX_DEBUG_LOGS = 200;

export function rectToObject(rect: DOMRect): Record<string, number> {
	return {
		x: rect.x,
		y: rect.y,
		width: rect.width,
		height: rect.height,
		top: rect.top,
		right: rect.right,
		bottom: rect.bottom,
		left: rect.left,
	};
}

export function summarizeNode(node: unknown): Record<string, unknown> | null {
	if (!isNodeLike(node)) {
		return node == null ? null : { type: typeof node, value: String(node) };
	}

	const root = typeof node.getRootNode === "function" ? node.getRootNode() : null;
	if (isElementLike(node)) {
		return {
			nodeType: node.nodeType,
			tag: node.tagName,
			className: node.className,
			id: node.id || null,
			rootType: root?.constructor?.name ?? null,
		};
	}

	return {
		nodeType: node.nodeType,
		nodeName: node.nodeName,
		rootType: root?.constructor?.name ?? null,
	};
}

export function summarizePopover(
	popover: HoverPopoverLike | null | undefined,
): Record<string, unknown> | null {
	if (!popover) return null;
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
	const handoff = session.pendingHandoff;
	const lifecycle = session.destroyed
		? "destroyed"
		: handoff
			? "handoff"
			: session.activePopover
				? "open"
				: session.activeAnchor
					? "hovering-anchor"
					: "idle";
	return {
		lifecycle,
		overAnchor: session.overAnchor,
		overPopover: session.overPopover,
		destroyed: session.destroyed,
		activeAnchorTag: session.activeAnchor?.proxyEl.tagName ?? null,
		activeAnchorClass: session.activeAnchor?.proxyEl.className ?? null,
		activeActualTag: session.activeAnchor?.actualEl.tagName ?? null,
		activeActualClass: session.activeAnchor?.actualEl.className ?? null,
		popover: summarizePopover(session.activePopover),
		lastHoverPath: session.lastHoverPath,
		hoverRequestSeq: session.requestSeq,
		pendingHandoff: handoff
			? {
					requestSeq: handoff.requestSeq,
					fromPopover: summarizePopover(handoff.fromPopover),
					fromActualClass: handoff.fromAnchor.actualEl.className,
					toActualClass: handoff.toAnchor.actualEl.className,
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
	if (!enableLogging) return;
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
	logger(`[ShadowHover][${type}] ${message}`, resolvedDetail);
}
