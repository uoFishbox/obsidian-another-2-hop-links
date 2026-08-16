import { isDocumentLike, isHTMLElementLike } from "ui/shared/dom/realmSafeDom";

export type RegistrationToken = symbol;

type WindowWithIntersectionObserver = Window & {
	IntersectionObserver?: typeof IntersectionObserver;
};

interface ObserverConfig {
	root?: Element | Document | null;
	rootMargin: string;
	threshold: number;
}

interface Registration {
	observer: IntersectionObserver;
	element: Element;
	callback: () => void;
	once: boolean;
	config: ObserverConfig;
	unregisterWindowMigration: (() => void) | null;
}

class IntersectionObserverRegistry {
	private static instance: IntersectionObserverRegistry;

	/** configKey → shared IntersectionObserver */
	private observers = new Map<string, IntersectionObserver>();
	/** observer → configKey */
	private observerKeys = new Map<IntersectionObserver, string>();
	/** token → one logical registration */
	private registrations = new Map<RegistrationToken, Registration>();
	/** observer -> element -> tokens */
	private registrationIndex = new Map<
		IntersectionObserver,
		Map<Element, Set<RegistrationToken>>
	>();
	private rootIds = new WeakMap<object, number>();
	private rootIdCounter = 0;
	private tokenScratch: RegistrationToken[] = [];

	private constructor() {}

	static getInstance(): IntersectionObserverRegistry {
		if (!IntersectionObserverRegistry.instance) {
			IntersectionObserverRegistry.instance = new IntersectionObserverRegistry();
		}
		return IntersectionObserverRegistry.instance;
	}

	observe(
		element: Element,
		callback: () => void,
		config: ObserverConfig = { rootMargin: "50px", threshold: 0 },
		once = true,
	): RegistrationToken {
		const ownerWindow = this.getObserverOwnerWindow(element, config.root ?? null);
		const observer = ownerWindow
			? this.getOrCreateObserver(config, ownerWindow)
			: null;

		// Preserve the previous fallback semantics when IntersectionObserver is
		// unavailable: treat the item as visible and do not retain a registration.
		if (!observer) {
			callback();
			return Symbol();
		}

		const token: RegistrationToken = Symbol();
		const registration: Registration = {
			observer,
			element,
			callback,
			once,
			config,
			unregisterWindowMigration: null,
		};
		this.registrations.set(token, registration);
		this.attachToObserver(token, registration, observer);

		if (
			isHTMLElementLike(element) &&
			typeof element.onWindowMigrated === "function"
		) {
			registration.unregisterWindowMigration = element.onWindowMigrated(() => {
				this.migrateRegistration(token);
			});
		}

		return token;
	}

	unobserve(token: RegistrationToken): void {
		const registration = this.registrations.get(token);
		if (!registration) return;

		this.registrations.delete(token);
		registration.unregisterWindowMigration?.();
		registration.unregisterWindowMigration = null;
		this.detachFromObserver(token, registration);
	}

	cleanup(): void {
		for (const registration of this.registrations.values()) {
			registration.unregisterWindowMigration?.();
		}
		for (const observer of this.observers.values()) {
			observer.disconnect();
		}
		this.observers.clear();
		this.observerKeys.clear();
		this.registrations.clear();
		this.registrationIndex.clear();
		this.rootIds = new WeakMap<object, number>();
		this.rootIdCounter = 0;
		this.tokenScratch.length = 0;
	}

	private migrateRegistration(token: RegistrationToken): void {
		const registration = this.registrations.get(token);
		if (!registration) return;

		this.detachFromObserver(token, registration);
		const ownerWindow = this.getObserverOwnerWindow(
			registration.element,
			registration.config.root ?? null,
		);
		const observer = ownerWindow
			? this.getOrCreateObserver(registration.config, ownerWindow)
			: null;

		if (!observer) {
			// Same behavior as a fresh registration in a realm without IO support.
			registration.callback();
			this.registrations.delete(token);
			registration.unregisterWindowMigration?.();
			registration.unregisterWindowMigration = null;
			return;
		}

		registration.observer = observer;
		this.attachToObserver(token, registration, observer);
	}

	private getOrCreateObserver(
		config: ObserverConfig,
		ownerWindow: WindowWithIntersectionObserver,
	): IntersectionObserver | null {
		const IntersectionObserverCtor = ownerWindow.IntersectionObserver;
		if (!IntersectionObserverCtor) return null;

		const configKey = this.getConfigKey(config, ownerWindow);
		const existing = this.observers.get(configKey);
		if (existing) return existing;

		let observer: IntersectionObserver;
		observer = new IntersectionObserverCtor(
			(entries) => this.handleIntersection(observer, entries),
			{
				root: config.root ?? null,
				rootMargin: config.rootMargin,
				threshold: config.threshold,
			},
		);
		this.observers.set(configKey, observer);
		this.observerKeys.set(observer, configKey);
		return observer;
	}

	private attachToObserver(
		token: RegistrationToken,
		registration: Registration,
		observer: IntersectionObserver,
	): void {
		let observerIndex = this.registrationIndex.get(observer);
		if (!observerIndex) {
			observerIndex = new Map<Element, Set<RegistrationToken>>();
			this.registrationIndex.set(observer, observerIndex);
		}
		let elementTokens = observerIndex.get(registration.element);
		if (!elementTokens) {
			elementTokens = new Set<RegistrationToken>();
			observerIndex.set(registration.element, elementTokens);
			observer.observe(registration.element);
		}
		elementTokens.add(token);
	}

	private detachFromObserver(
		token: RegistrationToken,
		registration: Registration,
	): void {
		const observer = registration.observer;
		const observerIndex = this.registrationIndex.get(observer);
		const elementTokens = observerIndex?.get(registration.element);
		if (!observerIndex || !elementTokens) return;

		elementTokens.delete(token);
		if (elementTokens.size === 0) {
			observerIndex.delete(registration.element);
			observer.unobserve(registration.element);
		}

		if (observerIndex.size === 0) {
			this.releaseObserver(observer);
		}
	}

	private releaseObserver(observer: IntersectionObserver): void {
		this.registrationIndex.delete(observer);
		observer.disconnect();
		const configKey = this.observerKeys.get(observer);
		if (configKey !== undefined) {
			this.observerKeys.delete(observer);
			this.observers.delete(configKey);
		}
	}

	private handleIntersection(
		observer: IntersectionObserver,
		entries: IntersectionObserverEntry[],
	): void {
		const observerIndex = this.registrationIndex.get(observer);
		if (!observerIndex) return;

		for (const entry of entries) {
			if (!entry.isIntersecting) continue;
			const elementTokens = observerIndex.get(entry.target);
			if (!elementTokens || elementTokens.size === 0) continue;

			this.tokenScratch.length = 0;
			for (const token of elementTokens) this.tokenScratch.push(token);

			for (const token of this.tokenScratch) {
				const registration = this.registrations.get(token);
				if (!registration) continue;
				registration.callback();
				if (registration.once) this.unobserve(token);
			}
		}
	}

	private getConfigKey(config: ObserverConfig, ownerWindow: Window): string {
		const windowKey = this.getObjectKey(ownerWindow);
		const rootKey = this.getRootKey(config.root ?? null);
		return `${windowKey}|${rootKey}|${config.rootMargin}|${config.threshold}`;
	}

	private getRootKey(root: Element | Document | null): string {
		return root ? this.getObjectKey(root) : "null";
	}

	private getObjectKey(value: object): string {
		const existingId = this.rootIds.get(value);
		if (existingId !== undefined) return String(existingId);
		const nextId = ++this.rootIdCounter;
		this.rootIds.set(value, nextId);
		return String(nextId);
	}

	private getObserverOwnerWindow(
		element: Element,
		root: Element | Document | null,
	): WindowWithIntersectionObserver | null {
		if (isDocumentLike(root)) {
			return root.defaultView as WindowWithIntersectionObserver | null;
		}
		return (root?.ownerDocument?.defaultView ??
			element.ownerDocument
				?.defaultView) as WindowWithIntersectionObserver | null;
	}
}

export function getLazyLoadManager(): IntersectionObserverRegistry {
	return IntersectionObserverRegistry.getInstance();
}
