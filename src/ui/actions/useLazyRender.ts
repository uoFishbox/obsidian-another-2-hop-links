import type { Action } from "svelte/action";
import {
	getLazyLoadManager,
	type RegistrationToken,
} from "infrastructure/observers/IntersectionObserverRegistry";
import {
	findNearestScrollContainer,
	isWithinComposedTree,
} from "ui/components/common/virtualGridLinkListScroll";
import { isHTMLElementLike, isShadowRootLike } from "ui/utils/realmSafeDom";

export interface LazyRenderActionParams {
	cacheKey?: string;
	minHeight?: number;
	rootMargin?: string;
	threshold?: number;
	intersectedCache?: Set<string>;
	observerRoot?: HTMLElement | null;
	onVisible: () => void;
}

const isSameLazyRenderParams = (
	current: LazyRenderActionParams,
	next: LazyRenderActionParams,
): boolean =>
	current.cacheKey === next.cacheKey &&
	current.rootMargin === next.rootMargin &&
	current.threshold === next.threshold &&
	current.intersectedCache === next.intersectedCache &&
	current.observerRoot === next.observerRoot &&
	current.onVisible === next.onVisible;

export const lazyRender: Action<HTMLElement, LazyRenderActionParams> = (
	node,
	initialParams,
) => {
	const lazyLoadManager = getLazyLoadManager();
	let params = initialParams;
	let visibleToken: RegistrationToken | undefined;
	let cachedObserverRoot: HTMLElement | null = null;
	let cachedObserverRootAnchor: HTMLElement | null = null;

	const cleanupVisibleObserver = () => {
		if (!visibleToken) return;
		lazyLoadManager.unobserve(visibleToken);
		visibleToken = undefined;
	};

	const cleanup = () => {
		cleanupVisibleObserver();
	};

	const wasCached = (cacheKey: string | undefined): boolean =>
		cacheKey ? (params.intersectedCache?.has(cacheKey) ?? false) : false;

	const resolveObserverRootCacheAnchor = (): HTMLElement | null => {
		const rootNode = node.getRootNode?.();
		return isShadowRootLike(rootNode) && isHTMLElementLike(rootNode.host)
			? rootNode.host
			: node.parentElement;
	};

	const resolveObserverRoot = (): HTMLElement | null => {
		if (params.observerRoot !== undefined) {
			cachedObserverRoot = params.observerRoot;
			cachedObserverRootAnchor = resolveObserverRootCacheAnchor();
			return params.observerRoot;
		}

		const currentAnchor = resolveObserverRootCacheAnchor();

		if (currentAnchor === null) {
			cachedObserverRoot = null;
			cachedObserverRootAnchor = null;
			return null;
		}

		if (
			currentAnchor === cachedObserverRootAnchor &&
			(cachedObserverRoot === null ||
				isWithinComposedTree(cachedObserverRoot, node))
		) {
			return cachedObserverRoot;
		}

		cachedObserverRoot = findNearestScrollContainer(node);
		cachedObserverRootAnchor = currentAnchor;
		return cachedObserverRoot;
	};

	const setup = () => {
		cleanup();

		const observerRoot = resolveObserverRoot();
		const cacheKey = params.cacheKey;

		if (wasCached(cacheKey)) {
			params.onVisible();
			return;
		}

		visibleToken = lazyLoadManager.observe(
			node,
			() => {
				params.onVisible();
				if (cacheKey && params.intersectedCache) {
					params.intersectedCache.add(cacheKey);
				}
			},
			{
				rootMargin: params.rootMargin ?? "50px",
				threshold: params.threshold ?? 0,
				root: observerRoot,
			},
			true,
		);
	};

	setup();

	return {
		update(nextParams) {
			if (isSameLazyRenderParams(params, nextParams)) {
				return;
			}

			params = nextParams;
			setup();
		},
		destroy() {
			cleanup();
		},
	};
};
