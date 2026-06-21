type ResizeCallback = () => void;

interface Entry {
	callbacks: Set<ResizeCallback>;
	dispatch: () => void;
	targetWindow: Window;
}

const entries = new WeakMap<Window, Entry>();

export function subscribeWindowResize(
	callback: ResizeCallback,
	targetWindow: Window = window,
): () => void {
	let entry = entries.get(targetWindow);
	if (!entry) {
		entry = {
			callbacks: new Set(),
			targetWindow,
			dispatch: () => {
				for (const cb of entry!.callbacks) {
					cb();
				}
			},
		};

		targetWindow.addEventListener("resize", entry.dispatch, {
			passive: true,
		});
		entries.set(targetWindow, entry);
	}

	entry.callbacks.add(callback);

	return () => {
		const current = entries.get(targetWindow);
		if (!current) {
			return;
		}

		current.callbacks.delete(callback);

		if (current.callbacks.size === 0) {
			targetWindow.removeEventListener("resize", current.dispatch);
			entries.delete(targetWindow);
		}
	};
}
