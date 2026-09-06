import type { FlatListScrollState } from "cards/list/model/listViewUiState";
import type {
	ProgrammaticScrollSnapshot,
	PublishedVirtualRangeContext,
} from "cards/virtualization/public";
import { getOptionalOwnerWindow } from "shared/ui/dom/realmSafeDom";

export interface FlatGridScrollStateOptions {
	readonly initialState?: FlatListScrollState;
	getRootEl(): HTMLElement | null;
	getScrollContainerEl(): HTMLElement | null;
	getSectionTop(): number;
	hasValidScrollMetrics(): boolean;
	getVisibleCount(): number;
	publish(state: FlatListScrollState): void;
	suppressNextNativeScroll(scrollTop: number): void;
	flushProgrammaticScrollMeasurement(snapshot: ProgrammaticScrollSnapshot): void;
}

export interface FlatGridScrollStateController {
	getCurrentMetrics(): PublishedVirtualRangeContext | null;
	restorePending(context: PublishedVirtualRangeContext): boolean;
	publishCurrent(context: PublishedVirtualRangeContext): void;
	persist(): void;
}

/** Owns one-shot restoration and external scroll-state publication for a flat grid. */
export function createFlatGridScrollStateController(
	options: FlatGridScrollStateOptions,
): FlatGridScrollStateController {
	let pendingRestore = options.initialState;

	function getCurrentMetrics(): PublishedVirtualRangeContext | null {
		const scrollContainerEl = options.getScrollContainerEl();
		const ownerWindow = getOptionalOwnerWindow(
			scrollContainerEl ?? options.getRootEl(),
		);
		if (!ownerWindow) return null;

		return {
			scrollTop: scrollContainerEl
				? scrollContainerEl.scrollTop
				: ownerWindow.scrollY || ownerWindow.pageYOffset || 0,
			viewportHeight: scrollContainerEl
				? scrollContainerEl.clientHeight
				: ownerWindow.innerHeight,
			sectionTop: options.getSectionTop(),
			isScrollActive: false,
		};
	}

	function restorePending(context: PublishedVirtualRangeContext): boolean {
		const restoreState = pendingRestore;
		if (!restoreState) return false;

		const scrollContainerEl = options.getScrollContainerEl();
		const ownerWindow = getOptionalOwnerWindow(
			scrollContainerEl ?? options.getRootEl(),
		);
		if (!ownerWindow) return false;

		pendingRestore = undefined;
		const targetScrollTop = Math.max(
			0,
			context.sectionTop + restoreState.localScrollTop,
		);
		if (scrollContainerEl) scrollContainerEl.scrollTop = targetScrollTop;
		else ownerWindow.scrollTo({ top: targetScrollTop });

		const restoredScrollTop = scrollContainerEl
			? scrollContainerEl.scrollTop
			: ownerWindow.scrollY || ownerWindow.pageYOffset || 0;
		if (restoredScrollTop !== context.scrollTop) {
			options.suppressNextNativeScroll(restoredScrollTop);
		}
		options.flushProgrammaticScrollMeasurement({
			scrollContainerEl,
			scrollTop: restoredScrollTop,
			viewportHeight: scrollContainerEl
				? scrollContainerEl.clientHeight
				: ownerWindow.innerHeight,
			sectionTop: context.sectionTop,
			didScroll: restoredScrollTop !== context.scrollTop,
		});
		return true;
	}

	function publishCurrent(context: PublishedVirtualRangeContext): void {
		options.publish({
			localScrollTop: Math.max(0, context.scrollTop - context.sectionTop),
			visibleCount: options.getVisibleCount(),
		});
	}

	function persist(): void {
		if (pendingRestore || !options.hasValidScrollMetrics()) return;
		const context = getCurrentMetrics();
		if (context) publishCurrent(context);
	}

	return { getCurrentMetrics, restorePending, publishCurrent, persist };
}
