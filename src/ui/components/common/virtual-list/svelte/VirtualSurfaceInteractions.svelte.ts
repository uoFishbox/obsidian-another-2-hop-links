import { onDestroy, tick } from "svelte";
import { createDelegatedInteractionDispatcher } from "ui/interactions/delegatedDispatcher";
import {
	createInteractionRegistry,
	setInteractionRegistryContext,
	type InteractionDescriptorResolver,
	type InteractionDescriptorResolverProvider,
} from "ui/interactions/interactionRegistry";
import { useAppContext, useLinkContext } from "ui/context/linkContext";
import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { InteractionDescriptor } from "ui/interactions/interactionTypes";
import type { MountedVirtualCell, VirtualNavigationTarget } from "../types";
import type { ProgrammaticScrollSnapshot } from "../dom/flushVirtualScrollMeasurement";
import type { VirtualCellRegistry } from "./VirtualCellRegistry";
import { installVirtualListInteractions } from "./VirtualListInteractions.svelte";
import {
	createVirtualSurfaceNavigation,
	type VirtualSurfaceNavigationContext,
} from "./VirtualSurfaceNavigation";

export interface VirtualSurfaceInteractionParams<
	TMountedCell extends MountedVirtualCell,
> {
	getRootEl(): HTMLDivElement | null;
	getContentEl(): HTMLDivElement | null;
	getShadowRoot(): ShadowRoot | null;
	setShadowRoot(shadowRoot: ShadowRoot | null): void;
	getObserverRoot(): HTMLElement | null;
	getRowHeight(): number;
	getInteractionDescriptorScopeId(): string | undefined;
	getInteractionDescriptors(): readonly InteractionDescriptor[];
	getInteractionDescriptorResolvers(): readonly InteractionDescriptorResolver[];
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
	moveFocusWithinList?: (
		currentTarget: HTMLElement,
		direction: ResultNavigationDirection,
		context: VirtualSurfaceNavigationContext,
	) => Promise<boolean>;
	flushVirtualScrollMeasurement?: (snapshot: ProgrammaticScrollSnapshot) => void;
	cellRegistry?: VirtualCellRegistry;
}

export function createVirtualSurfaceInteractions<
	TMountedCell extends MountedVirtualCell,
>({
	getRootEl,
	getContentEl,
	getShadowRoot,
	setShadowRoot,
	getObserverRoot,
	getRowHeight,
	getInteractionDescriptorScopeId,
	getInteractionDescriptors,
	getInteractionDescriptorResolvers,
	getInteractionDescriptorResolverProvider,
	resolveNavigationTarget,
	moveFocusWithinList,
	flushVirtualScrollMeasurement,
	cellRegistry,
}: VirtualSurfaceInteractionParams<TMountedCell>) {
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

	const flushMountedState = async (): Promise<void> => {
		await tick();
	};

	const handleKeyDown = createVirtualSurfaceNavigation({
		getRootEl,
		getContentEl,
		getScrollContainerEl: getObserverRoot,
		getRowHeight,
		delegatedInteractions,
		resolveNavigationTarget,
		moveFocusWithinList,
		flushVirtualScrollMeasurement,
		flushMountedState,
		cellRegistry,
	});

	installVirtualListInteractions({
		getRootEl,
		getContentEl,
		getShadowRoot,
		setShadowRoot,
		delegatedInteractions,
		interactionRegistry,
		linkContext,
		appContext,
	});

	let syncedInteractionDescriptorScopeId: string | undefined;
	let syncedInteractionDescriptorResolverProviderScopeId: string | undefined;

	function clearInteractionDescriptorScope(scopeId: string): void {
		interactionRegistry.syncInteractionDescriptors(scopeId, []);
		interactionRegistry.syncInteractionDescriptorResolvers(scopeId, []);
		interactionRegistry.syncInteractionDescriptorResolverProvider(
			scopeId,
			undefined,
		);
	}

	$effect(() => {
		const interactionDescriptorScopeId = getInteractionDescriptorScopeId();
		const interactionDescriptorResolverProvider =
			getInteractionDescriptorResolverProvider();
		if (
			syncedInteractionDescriptorScopeId &&
			syncedInteractionDescriptorScopeId !== interactionDescriptorScopeId
		) {
			clearInteractionDescriptorScope(syncedInteractionDescriptorScopeId);
		}
		if (
			syncedInteractionDescriptorResolverProviderScopeId &&
			(syncedInteractionDescriptorResolverProviderScopeId !==
				interactionDescriptorScopeId ||
				!interactionDescriptorResolverProvider)
		) {
			interactionRegistry.syncInteractionDescriptorResolverProvider(
				syncedInteractionDescriptorResolverProviderScopeId,
				undefined,
			);
			syncedInteractionDescriptorResolverProviderScopeId = undefined;
		}
		syncedInteractionDescriptorScopeId = interactionDescriptorScopeId;

		if (!interactionDescriptorScopeId) return;

		interactionRegistry.syncInteractionDescriptors(
			interactionDescriptorScopeId,
			getInteractionDescriptors(),
		);
		interactionRegistry.syncInteractionDescriptorResolvers(
			interactionDescriptorScopeId,
			getInteractionDescriptorResolvers(),
		);
		if (interactionDescriptorResolverProvider) {
			interactionRegistry.syncInteractionDescriptorResolverProvider(
				interactionDescriptorScopeId,
				interactionDescriptorResolverProvider,
			);
			syncedInteractionDescriptorResolverProviderScopeId =
				interactionDescriptorScopeId;
		}
	});

	onDestroy(() => {
		if (!syncedInteractionDescriptorScopeId) return;
		clearInteractionDescriptorScope(syncedInteractionDescriptorScopeId);
	});

	return {
		delegatedInteractions,
		handleKeyDown,
	};
}
