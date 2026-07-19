import { installShadowHoverPopoverBridge } from "features/preview/interactions/shadowHoverPopoverBridge";
import type { InteractionRegistry } from "ui/interactions/interactionRegistry";
import type { useAppContext, useLinkContext } from "ui/context/linkContext";
import { installVirtualListShadowSurface } from "./VirtualSurfaceRuntime";

export interface InstallVirtualListInteractionsParams {
	getRootEl: () => HTMLElement | null;
	getContentEl: () => HTMLElement | null;
	getShadowRoot: () => ShadowRoot | null;
	setShadowRoot: (shadowRoot: ShadowRoot | null) => void;
	delegatedInteractions: { clearLongPressTimer: () => void };
	interactionRegistry: InteractionRegistry;
	linkContext: ReturnType<typeof useLinkContext> | undefined;
	appContext: ReturnType<typeof useAppContext> | undefined;
}

export function installVirtualListInteractions({
	getRootEl,
	getContentEl,
	getShadowRoot,
	setShadowRoot,
	delegatedInteractions,
	interactionRegistry,
	linkContext,
	appContext,
}: InstallVirtualListInteractionsParams): void {
	const installShadowSurface = (): (() => void) | undefined => {
		const rootEl = getRootEl();
		const contentEl = getContentEl();
		if (!rootEl || !contentEl) {
			setShadowRoot(null);
			return;
		}

		const handles = installVirtualListShadowSurface(rootEl, contentEl);
		setShadowRoot(handles.shadowRoot);

		return () => {
			handles.dispose();
		};
	};

	const clearInteractionsOnDestroy = (): (() => void) => {
		return () => {
			delegatedInteractions.clearLongPressTimer();
			interactionRegistry.clear();
		};
	};

	const installHoverPopoverBridge = (): (() => void) | undefined => {
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
	};

	$effect(() => {
		return installShadowSurface();
	});

	$effect(() => {
		return clearInteractionsOnDestroy();
	});

	$effect(() => {
		return installHoverPopoverBridge();
	});
}
