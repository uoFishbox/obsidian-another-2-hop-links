import { tick } from "svelte";
import { Platform } from "obsidian";
import { createDelegatedInteractionDispatcher } from "cards/interactions/delegatedDispatcher";
import {
	createInteractionRegistry,
	setInteractionRegistryContext,
	type InteractionDescriptorResolverProvider,
} from "cards/interactions/interactionRegistry";
import { useAppContext, useLinkContext } from "cards/context/linkContext";
import type {
	NavigationDirection,
	SequentialNavigationDirection,
} from "cards/navigation/types";
import type {
	VirtualNavigationTarget,
	VirtualSequentialNavigationTarget,
} from "cards/virtualization/public";
import type { ProgrammaticScrollSnapshot } from "cards/virtualization/public";
import { createCardSurfaceNavigation } from "./surfaceNavigation";
import { ensureCardRenderShadowSurface } from "cards/components/cardRenderShadowSurface";
import { installShadowHoverPopoverBridge } from "hover-popover/shadowHoverPopoverBridge";
import { createVirtualCellBindingRegistry } from "./cellBindingRegistry";

export interface CardSurfaceInteractionParams {
	getRootEl(): HTMLDivElement | null;
	getContentEl(): HTMLDivElement | null;
	getShadowRoot(): ShadowRoot | null;
	setShadowRoot(shadowRoot: ShadowRoot | null): void;
	getObserverRoot(): HTMLElement | null;
	getRowHeight(): number;
	getInteractionDescriptorResolverProvider():
		| InteractionDescriptorResolverProvider
		| undefined;
	resolveNavigationTarget?: (
		currentKey: string,
		direction: NavigationDirection,
		currentPosition: {
			rowIndex: number;
			columnIndex: number;
		},
	) => VirtualNavigationTarget | null;
	resolveSequentialNavigationTarget?: (
		currentKey: string,
		direction: SequentialNavigationDirection,
		currentPosition: {
			rowIndex: number;
			columnIndex: number;
		},
	) => VirtualSequentialNavigationTarget | null;
	flushVirtualScrollMeasurement?: (snapshot: ProgrammaticScrollSnapshot) => void;
}

export function createCardSurfaceInteractions({
	getRootEl,
	getContentEl,
	getShadowRoot,
	setShadowRoot,
	getObserverRoot,
	getRowHeight,
	getInteractionDescriptorResolverProvider,
	resolveNavigationTarget,
	resolveSequentialNavigationTarget,
	flushVirtualScrollMeasurement,
}: CardSurfaceInteractionParams) {
	const interactionRegistry = createInteractionRegistry();
	setInteractionRegistryContext(interactionRegistry);

	let appContext: ReturnType<typeof useAppContext> | undefined;
	let linkContext: ReturnType<typeof useLinkContext> | undefined;
	try {
		appContext = useAppContext();
	} catch {
		appContext = undefined;
	}
	try {
		linkContext = useLinkContext();
	} catch {
		linkContext = appContext?.linkContext;
	}

	const delegatedInteractions = createDelegatedInteractionDispatcher({
		registry: interactionRegistry,
		linkContext,
		appContext,
	});
	const touchEventHandlers = Platform.isMobile
		? {
				ontouchstart: delegatedInteractions.handleTouchStart,
				ontouchmove: delegatedInteractions.handleTouchMove,
				ontouchend: delegatedInteractions.handleTouchEnd,
				ontouchcancel: delegatedInteractions.handleTouchEnd,
			}
		: {};

	const cellBindingRegistry = createVirtualCellBindingRegistry({
		onLogicalCellWillRebind: () => {
			delegatedInteractions.resetTransientState();
		},
	});

	const flushMountedState = async (): Promise<void> => {
		await tick();
	};

	const { handleKeyDown, handlePointerDown, handleFocusIn } =
		createCardSurfaceNavigation({
			getRootEl,
			getContentEl,
			getScrollContainerEl: getObserverRoot,
			getRowHeight,
			delegatedInteractions,
			cellBindingRegistry,
			resolveNavigationTarget,
			resolveSequentialNavigationTarget,
			flushVirtualScrollMeasurement,
			flushMountedState,
		});

	$effect(() => {
		const rootEl = getRootEl();
		const contentEl = getContentEl();
		if (!rootEl || !contentEl) {
			setShadowRoot(null);
			return;
		}

		const handles = ensureCardRenderShadowSurface(rootEl);
		if (contentEl.parentNode !== handles.surfaceEl) {
			handles.surfaceEl.append(contentEl);
		}
		setShadowRoot(handles.shadowRoot);

		return () => {
			handles.dispose();
		};
	});

	$effect(() => {
		return () => {
			delegatedInteractions.clearLongPressTimer();
			interactionRegistry.clear();
		};
	});

	$effect(() => {
		const shadowRoot = getShadowRoot();
		if (!shadowRoot) {
			return;
		}

		return installShadowHoverPopoverBridge({
			shadowRoot,
			registry: interactionRegistry,
			appContext,
		});
	});

	$effect(() => {
		const interactionDescriptorResolverProvider =
			getInteractionDescriptorResolverProvider();
		interactionRegistry.setInteractionDescriptorResolverProvider(
			interactionDescriptorResolverProvider,
		);
		return () =>
			interactionRegistry.setInteractionDescriptorResolverProvider(undefined);
	});

	return {
		delegatedInteractions,
		handleKeyDown,
		handlePointerDown,
		handleFocusIn,
		cellBindingRegistry,
		touchEventHandlers,
	};
}
