import { isDocumentLike } from "ui/shared/dom/realmSafeDom";

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
}

class IntersectionObserverRegistry {
	private static instance: IntersectionObserverRegistry;

	/** configKey → 共有 IntersectionObserver */
	private observers = new Map<string, IntersectionObserver>();
	/** observer → configKey */
	private observerKeys = new Map<IntersectionObserver, string>();

	/** token → 登録情報（1トークン = 1登録） */
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

	/**
	 * 要素を監視登録し、一意なトークンを返す。
	 * 同一要素に対して異なる config で複数回呼び出しても
	 * それぞれ独立したトークンで管理されるため干渉しない。
	 */
	observe(
		element: Element,
		callback: () => void,
		config: ObserverConfig = { rootMargin: "50px", threshold: 0 },
		once = true,
	): RegistrationToken {
		const ownerWindow = this.getObserverOwnerWindow(element, config.root ?? null);
		const IntersectionObserverCtor = ownerWindow?.IntersectionObserver;

		// IntersectionObserver が利用できない環境では即座に実行
		if (!IntersectionObserverCtor) {
			callback();
			// ダミートークンを返す（unobserve は no-op になる）
			return Symbol();
		}

		const configKey = this.getConfigKey(config, ownerWindow);
		let observer = this.observers.get(configKey);

		if (!observer) {
			// クロージャで observer 参照を束縛し、handleIntersection に渡す
			const newObserver = new IntersectionObserverCtor(
				(entries) => this.handleIntersection(newObserver, entries),
				{
					root: config.root ?? null,
					rootMargin: config.rootMargin,
					threshold: config.threshold,
				},
			);
			this.observers.set(configKey, newObserver);
			this.observerKeys.set(newObserver, configKey);
			observer = newObserver;
		}

		const token: RegistrationToken = Symbol();
		this.registrations.set(token, { observer, element, callback, once });
		let observerIndex = this.registrationIndex.get(observer);
		if (!observerIndex) {
			observerIndex = new Map<Element, Set<RegistrationToken>>();
			this.registrationIndex.set(observer, observerIndex);
		}
		let elementTokens = observerIndex.get(element);
		if (!elementTokens) {
			elementTokens = new Set<RegistrationToken>();
			observerIndex.set(element, elementTokens);
		}
		elementTokens.add(token);
		observer.observe(element);

		return token;
	}

	/**
	 * トークンで指定した登録のみを解除する。
	 * 同一要素の他の登録には影響しない。
	 */
	unobserve(token: RegistrationToken): void {
		const reg = this.registrations.get(token);
		if (!reg) return;

		this.registrations.delete(token);
		const observerIndex = this.registrationIndex.get(reg.observer);
		const elementTokens = observerIndex?.get(reg.element);
		if (!observerIndex || !elementTokens) {
			return;
		}

		elementTokens.delete(token);
		if (elementTokens.size === 0) {
			observerIndex.delete(reg.element);
			reg.observer.unobserve(reg.element);
		}

		if (observerIndex.size === 0) {
			this.releaseObserver(reg.observer);
		}
	}

	cleanup(): void {
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

			// callback 中の unobserve による Set 変更の影響を避ける
			this.tokenScratch.length = 0;
			for (const token of elementTokens) {
				this.tokenScratch.push(token);
			}

			for (const token of this.tokenScratch) {
				const reg = this.registrations.get(token);
				if (!reg) continue;

				reg.callback();
				if (reg.once) {
					this.unobserve(token);
				}
			}
		}
	}

	private getConfigKey(config: ObserverConfig, ownerWindow: Window): string {
		const windowKey = this.getObjectKey(ownerWindow);
		const rootKey = this.getRootKey(config.root ?? null);
		return `${windowKey}|${rootKey}|${config.rootMargin}|${config.threshold}`;
	}

	private getRootKey(root: Element | Document | null): string {
		if (!root) {
			return "null";
		}

		return this.getObjectKey(root);
	}

	private getObjectKey(value: object): string {
		const existingId = this.rootIds.get(value);
		if (existingId !== undefined) {
			return String(existingId);
		}

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

		const ownerWindow =
			root?.ownerDocument?.defaultView ?? element.ownerDocument?.defaultView;
		return ownerWindow as WindowWithIntersectionObserver | null;
	}
}

/**
 * シングルトンインスタンスを取得
 */
export function getLazyLoadManager(): IntersectionObserverRegistry {
	return IntersectionObserverRegistry.getInstance();
}
