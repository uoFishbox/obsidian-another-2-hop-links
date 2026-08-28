import { onDestroy, tick } from "svelte";
import { Platform } from "obsidian";
import { createDelegatedInteractionDispatcher } from "cards/interactions/delegatedDispatcher";
import {
	createInteractionRegistry,
	setInteractionRegistryContext,
	type InteractionDescriptorResolverProvider,
} from "cards/interactions/interactionRegistry";
import { useAppContext, useLinkContext } from "cards/context/linkContext";
import type { ResultNavigationDirection } from "cards/navigation/resultFocus";
import type { VirtualNavigationTarget } from "cards/virtualization/public";
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
	getInteractionDescriptorScopeId(): string | undefined;
	getInteractionDescriptorResolverProvider():
		| InteractionDescriptorResolverProvider
		| undefined;
	resolveNavigationTarget?: (
		currentKey: string,
		direction: ResultNavigationDirection,
		currentPosition: {
			rowIndex: number;
			columnIndex: number;
		},
	) => VirtualNavigationTarget | null;
	flushVirtualScrollMeasurement?: (snapshot: ProgrammaticScrollSnapshot) => void;
}

export function createCardSurfaceInteractions({
	getRootEl,
	getContentEl,
	getShadowRoot,
	setShadowRoot,
	getObserverRoot,
	getRowHeight,
	getInteractionDescriptorScopeId,
	getInteractionDescriptorResolverProvider,
	resolveNavigationTarget,
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

	const handleKeyDown = createCardSurfaceNavigation({
		getRootEl,
		getContentEl,
		getScrollContainerEl: getObserverRoot,
		getRowHeight,
		delegatedInteractions,
		cellBindingRegistry,
		resolveNavigationTarget,
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

	let syncedInteractionDescriptorScopeId: string | undefined;

	$effect(() => {
		const interactionDescriptorScopeId = getInteractionDescriptorScopeId();
		const interactionDescriptorResolverProvider =
			getInteractionDescriptorResolverProvider();
		if (
			syncedInteractionDescriptorScopeId &&
			syncedInteractionDescriptorScopeId !== interactionDescriptorScopeId
		) {
			interactionRegistry.syncInteractionDescriptorResolverProvider(
				syncedInteractionDescriptorScopeId,
				undefined,
			);
		}
		syncedInteractionDescriptorScopeId = interactionDescriptorScopeId;

		if (!interactionDescriptorScopeId) return;
		interactionRegistry.syncInteractionDescriptorResolverProvider(
			interactionDescriptorScopeId,
			interactionDescriptorResolverProvider,
		);
	});

	onDestroy(() => {
		if (!syncedInteractionDescriptorScopeId) return;
		interactionRegistry.syncInteractionDescriptorResolverProvider(
			syncedInteractionDescriptorScopeId,
			undefined,
		);
	});

	return {
		delegatedInteractions,
		handleKeyDown,
		cellBindingRegistry,
		touchEventHandlers,
	};
}
