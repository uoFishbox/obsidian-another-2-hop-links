import type { PluginHost } from "types/pluginHost";
import {
	forceCloseShadowDesktopPopover,
	getLastAssignedShadowDesktopPopoverForDebug,
	getShadowDesktopExperimentalKeepAlive,
	getShadowDesktopHoverDebugState,
	getShadowDesktopHoverParentForDebug,
	setShadowDesktopExperimentalKeepAlive,
} from "features/preview/interactions/mobilePopover";
import {
	freezePopoverForDebug,
	getCCLDebugAutoFreeze,
	getCCLDebugFrozenPopover,
	getCCLDebugLastSnapshot,
	snapshotPopoverForDebug,
	unfreezePopoverForDebug,
	setCCLDebugAutoFreeze,
} from "./CCLDebugRuntime";
import { ObsidianInternalFacade } from "infrastructure/capabilities/ObsidianInternalFacade";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
	type CCLDevMeasurementSnapshot,
} from "./CCLDevMeasurements";
import {
	createTwoHopPerformanceDebugApi,
	type TwoHopPerformanceDebugApi,
	type TwoHopScrollRun,
	type TwoHopScrollRunOptions,
	type TwoHopVirtualListDomStats,
	type TwoHopVirtualListQueryOptions,
} from "./twoHopPerformanceDebug";

interface CCLDevMeasurementsApi {
	readonly snapshot: CCLDevMeasurementSnapshot;
	getSnapshot(): CCLDevMeasurementSnapshot;
	reset(): CCLDevMeasurementSnapshot;
}

interface CCLDebugApi {
	readonly autoFreeze: boolean;
	readonly lastSnapshot: ReturnType<typeof getCCLDebugLastSnapshot>;
	readonly frozenPopover: unknown;
	readonly measurements: CCLDevMeasurementsApi;
	readonly twoHopPerformance: TwoHopPerformanceDebugApi;
	readonly app: PluginHost["app"];
	readonly plugin: PluginHost;
	readonly pagePreviewPlugin: unknown;
	readonly pagePreview: unknown;
	readonly hoverParent: unknown;
	readonly popover: unknown;
	readonly shadowState: ReturnType<typeof getShadowDesktopHoverDebugState>;
	readonly activeTargetEl: HTMLElement | null;
	readonly experimentalKeepAlive: boolean;
	getPagePreviewPrototype(): object | null;
	getPopoverPrototype(): object | null;
	dumpProtoChain(obj: unknown): Array<{
		level: number;
		ctor: string | undefined;
		ownKeys: string[];
	}>;
	findPrototypeOwner(
		obj: unknown,
		key: string,
	): {
		level: number;
		owner: object;
		descriptor: PropertyDescriptor | undefined;
	} | null;
	listOwnKeys(obj: unknown): string[];
	forceClose(reason?: string): void;
	setAutoFreeze(enabled: boolean): boolean;
	setExperimentalKeepAlive(enabled: boolean): boolean;
	freezeCurrentPopover(reason?: string): boolean;
	unfreezeCurrentPopover(): boolean;
	snapshotCurrentPopover(reason?: string): ReturnType<typeof getCCLDebugLastSnapshot>;
}

declare global {
	interface Window {
		__cclDebug?: CCLDebugApi;
		runTwoHopScroll?: (
			options?: TwoHopScrollRunOptions,
		) => Promise<TwoHopScrollRun>;
		getTwoHopVirtualListDomStats?: (
			options?: TwoHopVirtualListQueryOptions,
		) => TwoHopVirtualListDomStats;
	}
}

function getPagePreviewPlugin(plugin: PluginHost): unknown {
	const capability = new ObsidianInternalFacade(
		plugin.app,
	).getPagePreviewOnLinkHover();
	return capability.ok ? { instance: capability.value.instance } : undefined;
}

function getPagePreviewInstance(plugin: PluginHost): unknown {
	const capability = new ObsidianInternalFacade(
		plugin.app,
	).getPagePreviewOnLinkHover();
	return capability.ok ? capability.value.instance : undefined;
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

function findPrototypeOwner(
	obj: unknown,
	key: string,
): {
	level: number;
	owner: object;
	descriptor: PropertyDescriptor | undefined;
} | null {
	if (obj === null || obj === undefined) {
		return null;
	}

	let current: object | null =
		typeof obj === "object" || typeof obj === "function"
			? (obj as object)
			: Object(obj);
	let level = 0;

	while (current) {
		if (Object.prototype.hasOwnProperty.call(current, key)) {
			return {
				level,
				owner: current,
				descriptor: Object.getOwnPropertyDescriptor(current, key),
			};
		}
		current = Object.getPrototypeOf(current);
		level += 1;
	}

	return null;
}

function listOwnKeys(obj: unknown): string[] {
	if (obj === null || obj === undefined) {
		return [];
	}

	const target =
		typeof obj === "object" || typeof obj === "function"
			? (obj as object)
			: Object(obj);
	return Object.getOwnPropertyNames(target);
}

export function installCCLDebugExposure(plugin: PluginHost): void {
	const measurements: CCLDevMeasurementsApi = {
		get snapshot() {
			return getCCLDevMeasurementSnapshot();
		},
		getSnapshot() {
			return getCCLDevMeasurementSnapshot();
		},
		reset() {
			resetCCLDevMeasurements();
			return getCCLDevMeasurementSnapshot();
		},
	};
	const twoHopPerformance = createTwoHopPerformanceDebugApi({
		getMeasurementSnapshot: getCCLDevMeasurementSnapshot,
		resetMeasurements: resetCCLDevMeasurements,
	});
	const api: CCLDebugApi = {
		get autoFreeze() {
			return getCCLDebugAutoFreeze();
		},
		get lastSnapshot() {
			return getCCLDebugLastSnapshot();
		},
		get frozenPopover() {
			return getCCLDebugFrozenPopover();
		},
		get measurements() {
			return measurements;
		},
		twoHopPerformance,
		get app() {
			return plugin.app;
		},
		get plugin() {
			return plugin;
		},
		get pagePreviewPlugin() {
			return getPagePreviewPlugin(plugin);
		},
		get pagePreview() {
			return getPagePreviewInstance(plugin);
		},
		get hoverParent() {
			return getShadowDesktopHoverParentForDebug();
		},
		get popover() {
			return (
				getShadowDesktopHoverParentForDebug()?.hoverPopover ??
				getCCLDebugFrozenPopover() ??
				getLastAssignedShadowDesktopPopoverForDebug()
			);
		},
		get shadowState() {
			return getShadowDesktopHoverDebugState();
		},
		get experimentalKeepAlive() {
			return getShadowDesktopExperimentalKeepAlive();
		},
		get activeTargetEl() {
			return (
				(
					getShadowDesktopHoverParentForDebug()?.hoverPopover as
						| { targetEl?: HTMLElement | null }
						| undefined
				)?.targetEl ?? null
			);
		},
		getPagePreviewPrototype() {
			const instance = getPagePreviewInstance(plugin);
			if (
				!instance ||
				(typeof instance !== "object" && typeof instance !== "function")
			) {
				return null;
			}
			return Object.getPrototypeOf(instance);
		},
		getPopoverPrototype() {
			const popover =
				getShadowDesktopHoverParentForDebug()?.hoverPopover ??
				getCCLDebugFrozenPopover() ??
				getLastAssignedShadowDesktopPopoverForDebug();
			if (
				!popover ||
				(typeof popover !== "object" && typeof popover !== "function")
			) {
				return null;
			}
			return Object.getPrototypeOf(popover);
		},
		dumpProtoChain,
		findPrototypeOwner,
		listOwnKeys,
		forceClose(reason = "debug-force-close") {
			unfreezePopoverForDebug();
			forceCloseShadowDesktopPopover(reason);
		},
		setAutoFreeze(enabled: boolean) {
			return setCCLDebugAutoFreeze(enabled);
		},
		setExperimentalKeepAlive(enabled: boolean) {
			return setShadowDesktopExperimentalKeepAlive(enabled);
		},
		freezeCurrentPopover(reason = "debug-freeze-current") {
			return freezePopoverForDebug(
				getShadowDesktopHoverParentForDebug()?.hoverPopover ??
					getCCLDebugFrozenPopover() ??
					getLastAssignedShadowDesktopPopoverForDebug(),
				reason,
			);
		},
		unfreezeCurrentPopover() {
			return unfreezePopoverForDebug();
		},
		snapshotCurrentPopover(reason = "debug-snapshot-current") {
			return snapshotPopoverForDebug(
				getShadowDesktopHoverParentForDebug()?.hoverPopover ??
					getCCLDebugFrozenPopover() ??
					getLastAssignedShadowDesktopPopoverForDebug(),
				reason,
			);
		},
	};

	const runTwoHopScroll = (options?: TwoHopScrollRunOptions) =>
		twoHopPerformance.runScroll(options);
	const getTwoHopVirtualListDomStats = (
		options?: TwoHopVirtualListQueryOptions,
	) =>
		twoHopPerformance.getDomStats(options);
	window.__cclDebug = api;
	window.runTwoHopScroll = runTwoHopScroll;
	window.getTwoHopVirtualListDomStats = getTwoHopVirtualListDomStats;

	plugin.register(() => {
		if (window.__cclDebug === api) {
			delete window.__cclDebug;
		}
		if (window.runTwoHopScroll === runTwoHopScroll) {
			delete window.runTwoHopScroll;
		}
		if (window.getTwoHopVirtualListDomStats === getTwoHopVirtualListDomStats) {
			delete window.getTwoHopVirtualListDomStats;
		}
	});
}
