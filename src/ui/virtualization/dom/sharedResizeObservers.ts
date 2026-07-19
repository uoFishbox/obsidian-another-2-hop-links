export interface SharedResizeObserverRegistry<TSubscriber> {
	observer: ResizeObserver;
	subscribersByTarget: Map<HTMLElement, Set<TSubscriber>>;
}

export function observeSharedResizeTarget<TSubscriber>(
	registry: SharedResizeObserverRegistry<TSubscriber>,
	target: HTMLElement,
	subscriber: TSubscriber,
): void {
	let subscribers = registry.subscribersByTarget.get(target);
	if (!subscribers) {
		subscribers = new Set<TSubscriber>();
		registry.subscribersByTarget.set(target, subscribers);
		registry.observer.observe(target);
	}

	subscribers.add(subscriber);
}

export function unobserveSharedResizeTarget<TSubscriber>(
	registry: SharedResizeObserverRegistry<TSubscriber> | null,
	target: HTMLElement,
	subscriber: TSubscriber,
	onEmpty?: () => void,
): void {
	if (!registry) {
		return;
	}

	const subscribers = registry.subscribersByTarget.get(target);
	if (!subscribers) {
		return;
	}

	subscribers.delete(subscriber);
	if (subscribers.size > 0) {
		return;
	}

	registry.subscribersByTarget.delete(target);
	registry.observer.unobserve(target);
	if (registry.subscribersByTarget.size === 0) {
		registry.observer.disconnect();
		onEmpty?.();
	}
}
