import {
	ensureCardRenderShadowSurface,
	type CardRenderShadowSurfaceHandles,
} from "../../cardRenderShadowSurface";

export const installVirtualListShadowSurface = (
	host: HTMLElement,
	content: HTMLElement,
): CardRenderShadowSurfaceHandles => {
	const handles = ensureCardRenderShadowSurface(host);

	if (content.parentNode !== handles.mountEl) {
		handles.mountEl.append(content);
	}

	return handles;
};
