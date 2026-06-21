type ScrollActivityListener = (isActive: boolean) => void;

const activeSources = new Set<object>();
const listeners = new Set<ScrollActivityListener>();

function emit(isActive: boolean): void {
	for (const listener of listeners) {
		listener(isActive);
	}
}

export function isScrollActivityActive(): boolean {
	return activeSources.size > 0;
}

export function markScrollActivityActive(source: object): void {
	const wasActive = isScrollActivityActive();
	activeSources.add(source);
	if (!wasActive && isScrollActivityActive()) {
		emit(true);
	}
}

export function markScrollActivityIdle(source: object): void {
	if (!activeSources.delete(source)) {
		return;
	}

	if (!isScrollActivityActive()) {
		emit(false);
	}
}

export function subscribeScrollActivity(
	listener: ScrollActivityListener,
): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function resetScrollActivityForTests(): void {
	if (activeSources.size === 0) {
		return;
	}

	activeSources.clear();
	emit(false);
}
