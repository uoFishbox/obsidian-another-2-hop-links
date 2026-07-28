export type PreviewSurfaceVisibilityListener = (active: boolean) => void;

/**
 * Observes the containing workspace pane and reports whether preview work
 * should remain active for the mounted surface.
 */
export function observePreviewSurfaceVisibility(
	surface: HTMLElement,
	listener: PreviewSurfaceVisibilityListener,
): () => void {
	const ownerDocument = surface.ownerDocument;
	const ownerWindow = ownerDocument.defaultView;
	const target = surface.closest<HTMLElement>(".workspace-leaf-content") ?? surface;
	const IntersectionObserverConstructor = ownerWindow?.IntersectionObserver;
	let intersectsViewport: boolean | undefined = IntersectionObserverConstructor
		? undefined
		: true;
	let lastActive: boolean | undefined;

	const emit = (): void => {
		const active =
			ownerDocument.visibilityState !== "hidden" && intersectsViewport === true;
		if (active === lastActive) return;
		lastActive = active;
		listener(active);
	};

	const intersectionObserver = IntersectionObserverConstructor
		? new IntersectionObserverConstructor((entries) => {
				const entry = entries[entries.length - 1];
				if (!entry) return;
				intersectsViewport = entry.isIntersecting;
				emit();
			})
		: null;

	intersectionObserver?.observe(target);
	ownerDocument.addEventListener("visibilitychange", emit);
	emit();

	return () => {
		intersectionObserver?.disconnect();
		ownerDocument.removeEventListener("visibilitychange", emit);
	};
}
