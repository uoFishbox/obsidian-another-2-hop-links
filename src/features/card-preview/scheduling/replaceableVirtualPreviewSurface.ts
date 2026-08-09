import type {
	PreviewHostLease,
	VirtualPreviewSurface,
} from "features/card-preview/scheduling/virtualPreviewSurface";

interface HostRegistration {
	readonly slotId: string;
	readonly element: HTMLElement;
	lease: PreviewHostLease;
}

export interface ReplaceableVirtualPreviewSurface extends VirtualPreviewSurface {
	replace(surface: VirtualPreviewSurface): void;
}

/** Keeps preview-host registrations stable while replacing the backing surface. */
export function createReplaceableVirtualPreviewSurface(
	initialSurface: VirtualPreviewSurface,
): ReplaceableVirtualPreviewSurface {
	const registrations = new Set<HostRegistration>();
	let currentSurface = initialSurface;
	let disposed = false;

	function registerHost(slotId: string, element: HTMLElement): PreviewHostLease {
		if (disposed) return { dispose: () => {} };
		const registration: HostRegistration = {
			slotId,
			element,
			lease: currentSurface.registerHost(slotId, element),
		};
		registrations.add(registration);
		let active = true;
		return {
			dispose(): void {
				if (!active) return;
				active = false;
				registrations.delete(registration);
				registration.lease.dispose();
			},
		};
	}

	function replace(surface: VirtualPreviewSurface): void {
		if (disposed) {
			surface.dispose();
			return;
		}
		if (surface === currentSurface) return;

		for (const registration of registrations) {
			registration.lease.dispose();
		}
		currentSurface.dispose();
		currentSurface = surface;
		for (const registration of registrations) {
			registration.lease = currentSurface.registerHost(
				registration.slotId,
				registration.element,
			);
		}
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		currentSurface.dispose();
		registrations.clear();
	}

	return {
		registerHost,
		commit: (snapshot) => currentSurface.commit(snapshot),
		beginBindings: () => currentSurface.beginBindings(),
		bindSlot: (slotId, rowIndex, ownerKey, request) =>
			currentSurface.bindSlot(slotId, rowIndex, ownerKey, request),
		endBindings: () => currentSurface.endBindings(),
		setActiveRange: (start, end, active) =>
			currentSurface.setActiveRange(start, end, active),
		replace,
		dispose,
	};
}
