import { getOptionalOwnerWindow } from "ui/utils/realmSafeDom";
import { isContentBottomInPreloadRangeFromMetrics } from "../core/preloadRange";

export function isContentBottomInPreloadRange(
	sectionRoot: HTMLElement,
	contentHeight: number,
	root: HTMLElement | null,
	rootMargin: string,
): boolean {
	const ownerWindow = getOptionalOwnerWindow(sectionRoot);
	if (!ownerWindow) {
		return false;
	}

	const scrollTop = root
		? root.scrollTop
		: ownerWindow.scrollY || ownerWindow.pageYOffset || 0;
	const viewportHeight = root ? root.clientHeight : ownerWindow.innerHeight;
	const sectionRect = sectionRoot.getBoundingClientRect();
	const sectionTop = root
		? sectionRect.top - root.getBoundingClientRect().top + scrollTop
		: sectionRect.top + scrollTop;
	return isContentBottomInPreloadRangeFromMetrics({
		contentHeight,
		rootMargin,
		scrollTop,
		viewportHeight,
		sectionTop,
	});
}
