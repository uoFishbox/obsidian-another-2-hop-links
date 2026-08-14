export type ShadowHoverLinkSpec = {
	linktext: string;
	sourcePath: string;
	state?: Record<string, unknown> | unknown;
};

export type ShadowHoverLinkResolver = (
	interactionId: string,
) => ShadowHoverLinkSpec | null;

export type ShadowHoverController = {
	handleDelegatedEnter(
		anchorEl: HTMLElement,
		interactionId: string,
		event: MouseEvent,
	): void;
	handleDelegatedAnchorSync(
		anchorEl: HTMLElement,
		interactionId?: string,
		event?: MouseEvent,
	): void;
	handleDelegatedModifierKey(
		anchorEl: HTMLElement,
		interactionId: string,
		event: KeyboardEvent,
	): void;
	handleDelegatedPointerMove(
		anchorEl: HTMLElement,
		interactionId: string,
		event: PointerEvent,
	): void;
	handleDelegatedLeave(anchorEl: HTMLElement): void;
	releaseActivePopover(): void;
	syncActivePopover(): void;
	destroy(): void;
};
