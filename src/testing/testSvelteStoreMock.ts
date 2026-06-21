export type Unsubscriber = () => void;
export type Subscriber<T> = (value: T) => void;

export interface Readable<T> {
	subscribe(run: Subscriber<T>): Unsubscriber;
}

export interface Writable<T> extends Readable<T> {
	set(value: T): void;
	update(updater: (value: T) => T): void;
}

function toStoreArray<T>(
	stores: Readable<T> | Readable<T>[],
): Readable<T>[] {
	return Array.isArray(stores) ? stores : [stores];
}

export function writable<T>(initialValue: T): Writable<T> {
	let value = initialValue;
	const subscribers = new Set<Subscriber<T>>();

	const notify = () => {
		for (const subscriber of subscribers) {
			subscriber(value);
		}
	};

	return {
		subscribe(run: Subscriber<T>): Unsubscriber {
			run(value);
			subscribers.add(run);
			return () => {
				subscribers.delete(run);
			};
		},
		set(nextValue: T): void {
			value = nextValue;
			notify();
		},
		update(updater: (value: T) => T): void {
			value = updater(value);
			notify();
		},
	};
}

export function get<T>(store: Readable<T>): T {
	let value!: T;
	const unsubscribe = store.subscribe((nextValue) => {
		value = nextValue;
	});
	unsubscribe();
	return value;
}

export function derived<T, U>(
	stores: Readable<T> | Readable<T>[],
	mapper: (values: T[]) => U,
	initialValue?: U,
): Readable<U> {
	const sourceStores = toStoreArray(stores);
	let currentValue = initialValue as U;

	const subscribers = new Set<Subscriber<U>>();
	let sourceUnsubscribers: Unsubscriber[] = [];
	const values: T[] = new Array(sourceStores.length);
	const hasValue = new Array(sourceStores.length).fill(false);

	const notify = () => {
		for (const subscriber of subscribers) {
			subscriber(currentValue);
		}
	};

	const recompute = () => {
		if (!hasValue.every(Boolean)) {
			return;
		}
		currentValue = mapper(values);
		notify();
	};

	const start = () => {
		sourceUnsubscribers = sourceStores.map((store, index) =>
			store.subscribe((value) => {
				values[index] = value;
				hasValue[index] = true;
				recompute();
			}),
		);
	};

	const stop = () => {
		for (const unsubscribe of sourceUnsubscribers) {
			unsubscribe();
		}
		sourceUnsubscribers = [];
	};

	return {
		subscribe(run: Subscriber<U>): Unsubscriber {
			subscribers.add(run);
			if (subscribers.size === 1) {
				start();
			}
			run(currentValue);
			return () => {
				subscribers.delete(run);
				if (subscribers.size === 0) {
					stop();
				}
			};
		},
	};
}
