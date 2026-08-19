import { onDestroy, tick } from "svelte";
import { Platform } from "obsidian";
import { createDelegatedInteractionDispatcher } from "ui/interactions/delegatedDispatcher";
import {
	createInteractionRegistry,
	setInteractionRegistryContext,
	type InteractionDescriptorResolverProvider,
} from "ui/interactions/interactionRegistry";
import { useAppContext, useLinkContext } from "ui/context/linkContext";
import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { VirtualNavigationTarget } from "../types";
import type { ProgrammaticScrollSnapshot } from "../dom/virtualListMeasurementAdapter";
import { createVirtualSurfaceNavigation } from "./VirtualSurfaceNavigation";
import { ensureCardRenderShadowSurface } from "ui/components/common/cardRenderShadowSurface";
import { installShadowHoverPopoverBridge } from "features/popover/shadowHoverPopoverBridge";
import { createVirtualGridSurfaceTransaction } from "./VirtualGridSurfaceTransaction";

export interface VirtualSurfaceInteractionParams {
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

export function createVirtualSurfaceInteractions({
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
}: VirtualSurfaceInteractionParams) {
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

	const surfaceTransaction = createVirtualGridSurfaceTransaction({
		onLogicalCellWillRebind: () => {
			delegatedInteractions.resetTransientState();
		},
	});

	const flushMountedState = async (): Promise<void> => {
		await tick();
	};

	const handleKeyDown = createVirtualSurfaceNavigation({
		getRootEl,
		getContentEl,
		getScrollContainerEl: getObserverRoot,
		getRowHeight,
		delegatedInteractions,
		surfaceTransaction,
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
			linkContext,
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
		surfaceTransaction,
		touchEventHandlers,
	};
}
