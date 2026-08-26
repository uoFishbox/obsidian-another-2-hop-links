import { describe, expect, it, vi } from "vitest";
import { setupWorkspaceEventHandlers } from "../workspaceEventBootstrap";

describe("setupWorkspaceEventHandlers", () => {
	it("reconciles inline roots once after coalesced layout changes", () => {
		const handlers = new Map<string, () => void>();
		const postPaintCallbacks: Array<() => void> = [];
		const idleCallbacks: Array<() => void> = [];
		const reconcileInlineComponents = vi.fn();
		const rootSplit = {};
		const workspace = {
			rootSplit,
			on: vi.fn((event: string, handler: () => void) => {
				handlers.set(event, handler);
				return { event };
			}),
			getMostRecentLeaf: vi.fn(() => null),
		};
		const plugin = {
			registerEvent: vi.fn(),
		};
		const deps = {
			workspace,
			frameScheduler: {
				scheduleAfterFirstPaint: vi.fn((callback: () => void) => {
					postPaintCallbacks.push(callback);
				}),
				scheduleIdleOrNextFrame: vi.fn((callback: () => void) => {
					idleCallbacks.push(callback);
				}),
				scheduleOnNextFrame: vi.fn(),
				destroy: vi.fn(),
			},
			domMutationObserver: { initObservers: vi.fn() },
			emptyViewController: { sync: vi.fn() },
			propertyWidgetStyler: { pruneDisconnected: vi.fn() },
			displayModeManager: {
				reconcileInlineComponents,
				handleActiveLeafChange: vi.fn(),
			},
			viewUpdateOrchestrator: {
				updateActiveMarkdownViewDecorations: vi.fn(),
			},
			scrollManager: { clearHistory: vi.fn() },
			isUnloaded: () => false,
		};

		setupWorkspaceEventHandlers(plugin as never, deps as never);
		const layoutChange = handlers.get("layout-change");
		expect(layoutChange).toBeDefined();

		layoutChange?.();
		layoutChange?.();
		expect(postPaintCallbacks).toHaveLength(1);
		expect(reconcileInlineComponents).not.toHaveBeenCalled();

		postPaintCallbacks[0]();
		expect(reconcileInlineComponents).toHaveBeenCalledTimes(1);
		expect(deps.domMutationObserver.initObservers).toHaveBeenCalledTimes(1);
		expect(idleCallbacks).toHaveLength(1);

		const fileOpen = handlers.get("file-open");
		expect(fileOpen).toBeDefined();
		fileOpen?.();
		expect(workspace.getMostRecentLeaf).toHaveBeenCalledWith(rootSplit);
	});
});
