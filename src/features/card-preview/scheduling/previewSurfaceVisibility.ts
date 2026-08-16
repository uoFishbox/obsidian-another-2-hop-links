export type PreviewSurfaceVisibilityListener = (active: boolean) => void;

/**
 * Observes the containing workspace pane and reports whether preview work
 * should remain active for the mounted surface.
 *
 * Obsidian can adopt a mounted surface into a popout document without
 * recreating it. Rebind all document/window-owned observers when that happens.
 */
export function observePreviewSurfaceVisibility(
	surface: HTMLElement,
	listener: PreviewSurfaceVisibilityListener,
): () => void {
	let intersectionObserver: IntersectionObserver | null = null;
	let observedDocument: Document | null = null;
	let intersectsViewport: boolean | undefined;
	let lastActive: boolean | undefined;
	let disposed = false;

	const emit = (): void => {
		if (disposed || !observedDocument) return;
		const active =
			observedDocument.visibilityState !== "hidden" &&
			intersectsViewport === true;
		if (active === lastActive) return;
		lastActive = active;
		listener(active);
	};

	const unbindRealm = (): void => {
		intersectionObserver?.disconnect();
		intersectionObserver = null;
		observedDocument?.removeEventListener("visibilitychange", emit);
		observedDocument = null;
	};

	const bindRealm = (): void => {
		unbindRealm();
		if (disposed) return;

		const ownerDocument = surface.ownerDocument;
		const ownerWindow = ownerDocument.defaultView;
		observedDocument = ownerDocument;
		const target =
			surface.closest<HTMLElement>(".workspace-leaf-content") ?? surface;
		const IntersectionObserverConstructor = ownerWindow?.IntersectionObserver;
		intersectsViewport = IntersectionObserverConstructor ? undefined : true;
		lastActive = undefined;

		intersectionObserver = IntersectionObserverConstructor
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
	};

	const unregisterWindowMigration =
		typeof surface.onWindowMigrated === "function"
			? surface.onWindowMigrated(() => bindRealm())
			: null;

	bindRealm();

	return () => {
		disposed = true;
		unregisterWindowMigration?.();
		unbindRealm();
	};
}
