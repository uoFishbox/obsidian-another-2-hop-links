interface PopoverLikeForDebug {
	hide?: (...args: unknown[]) => unknown;
	close?: (...args: unknown[]) => unknown;
	unload?: (...args: unknown[]) => unknown;
	hoverEl?: HTMLElement | null;
	targetEl?: HTMLElement | null;
	state?: unknown;
}

export interface CCLDebugSnapshot {
	reason: string;
	timestamp: string;
	ctorName: string | undefined;
	state: unknown;
	targetElTag: string | null;
	targetElClassName: string | null;
	targetElDataset: Record<string, string> | null;
	hoverElTag: string | null;
	hoverElClassName: string | null;
	ownKeys: string[];
	constructorKeys: string[];
	prototypeChain: Array<{
		level: number;
		ctor: string | undefined;
		ownKeys: string[];
	}>;
}

let autoFreezeEnabled = false;
let lastSnapshot: CCLDebugSnapshot | null = null;
let frozenPopover: PopoverLikeForDebug | null = null;
let frozenPopoverOriginalHide: ((...args: unknown[]) => unknown) | null = null;
let frozenPopoverOriginalClose: ((...args: unknown[]) => unknown) | null = null;
let frozenPopoverOriginalUnload: ((...args: unknown[]) => unknown) | null = null;

function isObjectLike(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function dumpProtoChain(obj: unknown): Array<{
	level: number;
	ctor: string | undefined;
	ownKeys: string[];
}> {
	const rows: Array<{
		level: number;
		ctor: string | undefined;
		ownKeys: string[];
	}> = [];

	if (obj === null || obj === undefined) {
		return rows;
	}

	let current: object | null =
		typeof obj === "object" || typeof obj === "function"
			? (obj as object)
			: Object(obj);
	let level = 0;

	while (current) {
		rows.push({
			level,
			ctor: (current as { constructor?: { name?: string } }).constructor?.name,
			ownKeys: Object.getOwnPropertyNames(current),
		});
		current = Object.getPrototypeOf(current);
		level += 1;
	}

	return rows;
}

function serializeDataset(
	el: HTMLElement | null | undefined,
): Record<string, string> | null {
	if (!el) {
		return null;
	}

	return Object.fromEntries(
		Object.entries(el.dataset).filter(
			(entry): entry is [string, string] => entry[1] !== undefined,
		),
	);
}

export function getCCLDebugAutoFreeze(): boolean {
	return autoFreezeEnabled;
}

export function setCCLDebugAutoFreeze(enabled: boolean): boolean {
	autoFreezeEnabled = Boolean(enabled);
	return autoFreezeEnabled;
}

export function getCCLDebugLastSnapshot(): CCLDebugSnapshot | null {
	return lastSnapshot;
}

export function getCCLDebugFrozenPopover(): unknown {
	return frozenPopover;
}

export function isPopoverFrozenForDebug(popover: unknown): boolean {
	return Boolean(popover && frozenPopover === popover);
}

export function snapshotPopoverForDebug(
	popover: unknown,
	reason = "manual-snapshot",
): CCLDebugSnapshot | null {
	if (!isObjectLike(popover)) {
		return null;
	}

	const typedPopover = popover as PopoverLikeForDebug & {
		constructor?: { name?: string };
	};
	const ctor = (typedPopover as { constructor?: unknown }).constructor;
	const targetEl = typedPopover.targetEl ?? null;
	const hoverEl = typedPopover.hoverEl ?? null;

	lastSnapshot = {
		reason,
		timestamp: new Date().toISOString(),
		ctorName: typedPopover.constructor?.name,
		state: typedPopover.state,
		targetElTag: targetEl?.tagName ?? null,
		targetElClassName: targetEl?.className ?? null,
		targetElDataset: serializeDataset(targetEl),
		hoverElTag: hoverEl?.tagName ?? null,
		hoverElClassName: hoverEl?.className ?? null,
		ownKeys: Object.getOwnPropertyNames(popover),
		constructorKeys:
			ctor && (typeof ctor === "object" || typeof ctor === "function")
				? Object.getOwnPropertyNames(ctor)
				: [],
		prototypeChain: dumpProtoChain(popover),
	};

	return lastSnapshot;
}

export function freezePopoverForDebug(
	popover: unknown,
	reason = "manual-freeze",
): boolean {
	if (!isObjectLike(popover)) {
		return false;
	}

	const typedPopover = popover as PopoverLikeForDebug & {
		__cclDebugHideBlocked?: boolean;
		__cclDebugCloseBlocked?: boolean;
		__cclDebugUnloadBlocked?: boolean;
	};

	snapshotPopoverForDebug(popover, `${reason}:snapshot`);

	if (
		frozenPopover === typedPopover &&
		typedPopover.__cclDebugHideBlocked &&
		typedPopover.__cclDebugCloseBlocked &&
		typedPopover.__cclDebugUnloadBlocked
	) {
		return true;
	}

	unfreezePopoverForDebug();

	frozenPopover = typedPopover;
	frozenPopoverOriginalHide =
		typeof typedPopover.hide === "function"
			? typedPopover.hide.bind(typedPopover)
			: null;
	frozenPopoverOriginalClose =
		typeof typedPopover.close === "function"
			? typedPopover.close.bind(typedPopover)
			: null;
	frozenPopoverOriginalUnload =
		typeof typedPopover.unload === "function"
			? typedPopover.unload.bind(typedPopover)
			: null;

	typedPopover.hide = (...args: unknown[]): void => {
		console.info("[CCLDebug] blocked popover.hide()", {
			reason,
			args,
			popover: typedPopover,
		});
	};
	typedPopover.close = (...args: unknown[]): void => {
		console.info("[CCLDebug] blocked popover.close()", {
			reason,
			args,
			popover: typedPopover,
		});
	};
	typedPopover.unload = (...args: unknown[]): void => {
		console.info("[CCLDebug] blocked popover.unload()", {
			reason,
			args,
			popover: typedPopover,
		});
	};
	typedPopover.__cclDebugHideBlocked = true;
	typedPopover.__cclDebugCloseBlocked = true;
	typedPopover.__cclDebugUnloadBlocked = true;
	return true;
}

export function unfreezePopoverForDebug(): boolean {
	if (!frozenPopover) {
		return false;
	}

	const target = frozenPopover as PopoverLikeForDebug & {
		__cclDebugHideBlocked?: boolean;
		__cclDebugCloseBlocked?: boolean;
		__cclDebugUnloadBlocked?: boolean;
	};

	if (frozenPopoverOriginalHide) {
		target.hide = frozenPopoverOriginalHide;
	}
	if (frozenPopoverOriginalClose) {
		target.close = frozenPopoverOriginalClose;
	}
	if (frozenPopoverOriginalUnload) {
		target.unload = frozenPopoverOriginalUnload;
	}

	delete target.__cclDebugHideBlocked;
	delete target.__cclDebugCloseBlocked;
	delete target.__cclDebugUnloadBlocked;
	frozenPopover = null;
	frozenPopoverOriginalHide = null;
	frozenPopoverOriginalClose = null;
	frozenPopoverOriginalUnload = null;
	return true;
}

export function handlePopoverOpenedForDebug(
	popover: unknown,
	reason = "popover-opened",
): void {
	snapshotPopoverForDebug(popover, reason);
	if (autoFreezeEnabled) {
		freezePopoverForDebug(popover, `${reason}:autofreeze`);
	}
}
