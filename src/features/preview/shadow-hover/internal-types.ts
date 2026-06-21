import type { ShadowAnchorRegistry } from "./registry";

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

export type PopoverPatchState = {
	ownerSession: ShadowHoverSession;
	originals: {
		hide?: HoverPopoverLike["hide"];
		close?: HoverPopoverLike["close"];
		unload?: HoverPopoverLike["unload"];
		position?: HoverPopoverLike["position"];
		detect?: HoverPopoverLike["detect"];
		transition?: HoverPopoverLike["transition"];
	};
	dispose(): void;
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

export type DebugLogEntry = {
	index: number;
	at: number;
	type: string;
	message: string;
	detail?: unknown;
};

export type PendingPopoverHandoff = {
	fromPopover: HoverPopoverLike;
	fromActualAnchor: HTMLElement;
	toActualAnchor: HTMLElement;
	requestSeq: number;
};

export interface HoverAnchorTarget {
	actualEl: HTMLElement;
	proxyEl: HTMLElement;
}

export interface HoverSessionOpenPopover {
	popover: HoverPopoverLike;
	hoverParent: HoverParentLike | null;
}

export type HoverSessionCloseReason =
	| "manual"
	| "handoff-timeout"
	| "destroy";

export type HoverSessionState =
	| { type: "idle"; requestSeq: number }
	| {
			type: "hovering-anchor";
			anchor: HoverAnchorTarget;
			requestSeq: number;
	  }
	| {
			type: "opening";
			anchor: HoverAnchorTarget;
			requestSeq: number;
			previous: HoverSessionOpenPopover | null;
	  }
	| {
			type: "open";
			anchor: HoverAnchorTarget;
			requestSeq: number;
			assigned: HoverSessionOpenPopover;
	  }
	| {
			type: "handoff";
			from: HoverSessionOpenPopover & { anchor: HoverAnchorTarget };
			to: HoverAnchorTarget;
			requestSeq: number;
	  }
	| {
			type: "closing";
			anchor: HoverAnchorTarget | null;
			requestSeq: number;
			popover: HoverPopoverLike;
			hoverParent: HoverParentLike | null;
			reason: HoverSessionCloseReason;
	  }
	| { type: "destroyed"; requestSeq: number };

export type HoverSessionEvent =
	| { type: "anchor-sync"; anchor: HoverAnchorTarget }
	| {
			type: "request-open";
			anchor: HoverAnchorTarget;
			requestSeq: number;
	  }
	| { type: "request-cancel"; requestSeq: number }
	| {
			type: "handoff-start";
			fromPopover: HoverPopoverLike;
			fromHoverParent: HoverParentLike | null;
			fromAnchor: HoverAnchorTarget;
			toAnchor: HoverAnchorTarget;
			requestSeq: number;
	  }
	| {
			type: "popover-assigned";
			popover: HoverPopoverLike;
			hoverParent: HoverParentLike;
			anchor: HoverAnchorTarget;
			requestSeq: number;
	  }
	| {
			type: "popover-cleared";
			popover: HoverPopoverLike;
			hoverParent: HoverParentLike;
	  }
	| { type: "handoff-timeout"; requestSeq: number }
	| {
			type: "close-start";
			popover: HoverPopoverLike;
			reason: HoverSessionCloseReason;
	  }
	| { type: "close-finish"; popover: HoverPopoverLike }
	| { type: "destroy" };

export interface HoverSessionInteractionState {
	overAnchor: boolean;
	overPopover: boolean;
	outsideInteractionUntil: number;
}

export type HoverSessionInteractionEvent =
	| {
			type: "interaction-sync";
			overAnchor: boolean;
			overPopover: boolean;
	  }
	| { type: "anchor-hover-sync"; overAnchor: boolean }
	| { type: "popover-hover-sync"; overPopover: boolean }
	| { type: "outside-interaction"; until: number }
	| { type: "interaction-reset" };

export type ShadowHoverSession = {
	anchorRegistry: ShadowAnchorRegistry;
	state: HoverSessionState;
	interaction: HoverSessionInteractionState;
	allowClose: boolean;
	attachedPopoverEl: HTMLElement | null;
	teardownPopoverListeners: (() => void) | null;
	teardownInteractionListeners: (() => void) | null;
	shownStateValue: unknown;
	lastHoverPath: string | null;
	handoffTimer: number | null;
	logs: DebugLogEntry[];
	logSeq: number;
};
