import {
	ensureCardRenderShadowSurface,
	type CardRenderShadowSurfaceHandles,
} from "../../cardRenderShadowSurface";

export const installVirtualListShadowSurface = (
	host: HTMLElement,
	content: HTMLElement,
): CardRenderShadowSurfaceHandles => {
	const handles = ensureCardRenderShadowSurface(host);

	if (content.parentNode !== handles.surfaceEl) {
		handles.surfaceEl.append(content);
	}

	return handles;
};
