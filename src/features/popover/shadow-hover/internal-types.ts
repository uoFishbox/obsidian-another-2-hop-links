import type { ShadowGeometryProxyStore } from "./geometry-proxy";

export type HoverPopoverLike = {
	hoverEl?: HTMLElement;
	targetEl?: HTMLElement | null;
	onTarget?: boolean;
	onHover?: boolean;
	isFocused?: boolean;
	setIsFocused?: (focused: boolean) => void;
	timer?: number | null;
	state?: unknown;
	position?: (...args: unknown[]) => unknown;
	detect?: (...args: unknown[]) => unknown;
	transition?: (...args: unknown[]) => unknown;
	shouldShowSelf?: (...args: unknown[]) => unknown;
	show?: (...args: unknown[]) => unknown;
	hide?: (...args: unknown[]) => unknown;
	close?: (...args: unknown[]) => unknown;
	unload?: (...args: unknown[]) => unknown;
	[key: string]: unknown;
};

export type HoverParentLike = {
	hoverPopover?: HoverPopoverLike | null;
	[key: string]: unknown;
};

export type HoverLinkPayloadLike = {
	event: MouseEvent;
	source: string;
	hoverParent: HoverParentLike;
	targetEl: HTMLElement;
	linktext: string;
	sourcePath: string;
	state?: Record<string, unknown>;
	[key: string]: unknown;
};

export interface HoverAnchorTarget {
	actualEl: HTMLElement;
	proxyEl: HTMLElement;
}

export type PendingPopoverHandoff = {
	fromPopover: HoverPopoverLike;
	fromHoverParent: HoverParentLike | null;
	fromAnchor: HoverAnchorTarget;
	toAnchor: HoverAnchorTarget;
	requestSeq: number;
};

export type ShadowHoverSession = {
	proxyStore: ShadowGeometryProxyStore;
	hoveredActuals: Set<HTMLElement>;
	activeAnchor: HoverAnchorTarget | null;
	activePopover: HoverPopoverLike | null;
	activeHoverParent: HoverParentLike | null;
	pendingHandoff: PendingPopoverHandoff | null;
	requestSeq: number;
	destroyed: boolean;
	overAnchor: boolean;
	overPopover: boolean;
	attachedPopoverEl: HTMLElement | null;
	teardownPopoverListeners: (() => void) | null;
	handoffTimer: number | null;
	handoffTimerWindow: Window | null;
};
