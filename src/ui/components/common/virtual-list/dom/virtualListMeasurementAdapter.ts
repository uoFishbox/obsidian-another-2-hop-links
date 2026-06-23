import { getOptionalOwnerWindow } from "ui/utils/realmSafeDom";

export interface VirtualListScrollMetrics {
	sectionRect: DOMRect;
	scrollTop: number;
	viewportHeight: number;
	sectionTop: number;
}

export interface VirtualListScrollSnapshot {
	scrollTop: number;
	viewportHeight: number;
}

export type MeasurementUpdateResult<TRange> =
	| { kind: "stable"; range: TRange }
	| { kind: "bootstrapped"; range: TRange }
	| { kind: "skipped"; reason: "no-window" | "no-root" | "unstable" };

export function readScrollSnapshot(
	scrollContainer: HTMLElement | null,
	viewportHeightOverride?: number,
	out: VirtualListScrollSnapshot = {
		scrollTop: 0,
		viewportHeight: 0,
	},
	ownerElement?: HTMLElement | null,
): VirtualListScrollSnapshot {
	const ownerWindow = getOptionalOwnerWindow(scrollContainer ?? ownerElement);
	if (!ownerWindow) {
		out.scrollTop = 0;
		out.viewportHeight = 0;
		return out;
	}

	if (scrollContainer) {
		out.scrollTop = scrollContainer.scrollTop;
		out.viewportHeight = viewportHeightOverride ?? scrollContainer.clientHeight;
		return out;
	}

	out.scrollTop = ownerWindow.scrollY || ownerWindow.pageYOffset || 0;
	out.viewportHeight = ownerWindow.innerHeight;
	return out;
}

export const getScrollSnapshot = (
	scrollContainer: HTMLElement | null,
	viewportHeightOverride?: number,
	ownerElement?: HTMLElement | null,
): VirtualListScrollSnapshot =>
	readScrollSnapshot(
		scrollContainer,
		viewportHeightOverride,
		undefined,
		ownerElement,
	);

export const getScrollMetrics = (
	element: HTMLElement,
	scrollContainer: HTMLElement | null,
	sectionRect: DOMRect = element.getBoundingClientRect(),
): VirtualListScrollMetrics => {
	const scrollSnapshot = readScrollSnapshot(
		scrollContainer,
		undefined,
		undefined,
		element,
	);

	if (scrollContainer) {
		const rootRect = scrollContainer.getBoundingClientRect();
		return {
			sectionRect,
			scrollTop: scrollSnapshot.scrollTop,
			viewportHeight: scrollSnapshot.viewportHeight,
			sectionTop: sectionRect.top - rootRect.top + scrollSnapshot.scrollTop,
		};
	}

	return {
		sectionRect,
		scrollTop: scrollSnapshot.scrollTop,
		viewportHeight: scrollSnapshot.viewportHeight,
		sectionTop: sectionRect.top + scrollSnapshot.scrollTop,
	};
};
