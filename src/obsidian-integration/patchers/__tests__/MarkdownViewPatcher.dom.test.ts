import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getActiveInlineContainerSpy, titleNavigationSpies } = vi.hoisted(() => ({
	getActiveInlineContainerSpy: vi.fn(),
	titleNavigationSpies: {
		Enter: vi.fn(),
		Backspace: vi.fn(),
		PageUp: vi.fn(),
	},
}));

vi.mock("shared/ui/dom/domUtils", () => ({
	getActiveInlineContainer: getActiveInlineContainerSpy,
}));

vi.mock("obsidian-integration/navigation/markdownTitleEditorNavigationBridge", () => ({
	handleMarkdownInlineTitleEnter: titleNavigationSpies.Enter,
	handleMarkdownEditorBackspace: titleNavigationSpies.Backspace,
	handleMarkdownEditorPageUp: titleNavigationSpies.PageUp,
}));

vi.mock("obsidian", () => {
	class TFile {
		path = "";
	}

	class MarkdownView {
		containerEl = document.createElement("div");
		file: TFile | null = null;

		onload(): string {
			return "onload-result";
		}

		async onLoadFile(file: TFile): Promise<string> {
			this.file = file;
			return "load-result";
		}

		async onUnloadFile(file: TFile): Promise<string> {
			if (this.file === file) {
				this.file = null;
			}
			return "unload-result";
		}
	}

	return {
		MarkdownView,
		TFile,
	};
});

import { MarkdownView, TFile } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type { PluginHost } from "obsidian-integration/pluginHost";
import { initFilePatcher } from "../MarkdownViewPatcher";

function createPlugin(displayMode: "editor-inline" | "hybrid" | "sidebar") {
	const unregisterCallbacks: Array<() => void> = [];
	const plugin = {
		app: {
			workspace: {
				iterateAllLeaves: vi.fn(),
			},
		},
		settings: {
			displayMode,
			experimentalCosenseTitleEditing: false,
		},
		componentController: {
			mountComponentsForView: vi.fn(),
			unmountViewComponents: vi.fn(),
		},
		register: vi.fn((unregister: () => void) => {
			unregisterCallbacks.push(unregister);
		}),
	};

	return {
		plugin,
		cleanup: () => {
			while (unregisterCallbacks.length > 0) {
				unregisterCallbacks.pop()?.();
			}
		},
	};
}

describe("MarkdownViewPatcher", () => {
	beforeEach(() => {
		getActiveInlineContainerSpy.mockReset();
		for (const spy of Object.values(titleNavigationSpies)) {
			spy.mockReset().mockReturnValue(false);
		}
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each(["Enter", "Backspace", "PageUp"] as const)(
		"toggles %s handling immediately in an already open view",
		(key) => {
			const { plugin, cleanup } = createPlugin("editor-inline");
			const view = new MarkdownView({} as WorkspaceLeaf);
			plugin.app.workspace.iterateAllLeaves.mockImplementation(
				(callback: (leaf: { view: MarkdownView }) => void) =>
					callback({ view }),
			);
			initFilePatcher(plugin as unknown as PluginHost);
			const dispatch = (): KeyboardEvent => {
				const event = new KeyboardEvent("keydown", {
					key,
					bubbles: true,
					cancelable: true,
				});
				view.containerEl.dispatchEvent(event);
				return event;
			};

			try {
				expect(dispatch().defaultPrevented).toBe(false);
				for (const spy of Object.values(titleNavigationSpies)) {
					expect(spy).not.toHaveBeenCalled();
				}

				plugin.settings = {
					...plugin.settings,
					experimentalCosenseTitleEditing: true,
				};
				titleNavigationSpies[key].mockImplementation(
					(_view: MarkdownView, event: KeyboardEvent) => {
						event.preventDefault();
						return true;
					},
				);
				expect(dispatch().defaultPrevented).toBe(true);
				expect(titleNavigationSpies[key]).toHaveBeenCalledTimes(1);

				plugin.settings = {
					...plugin.settings,
					experimentalCosenseTitleEditing: false,
				};
				expect(dispatch().defaultPrevented).toBe(false);
				expect(titleNavigationSpies[key]).toHaveBeenCalledTimes(1);

				plugin.settings = {
					...plugin.settings,
					experimentalCosenseTitleEditing: true,
				};
				cleanup();
				expect(dispatch().defaultPrevented).toBe(false);
				expect(titleNavigationSpies[key]).toHaveBeenCalledTimes(1);
			} finally {
				cleanup();
			}
		},
	);

	it("prepares inline containers on file load without mounting components", async () => {
		const { plugin, cleanup } = createPlugin("editor-inline");
		initFilePatcher(plugin as any);

		try {
			const view = new (MarkdownView as any)();
			const file = new (TFile as any)();
			file.path = "notes/alpha.md";

			await view.onLoadFile(file);

			expect(getActiveInlineContainerSpy).toHaveBeenCalledTimes(1);
			expect(getActiveInlineContainerSpy).toHaveBeenCalledWith(view);
			expect(
				plugin.componentController.mountComponentsForView,
			).not.toHaveBeenCalled();
		} finally {
			cleanup();
		}
	});

	it("skips container preparation outside inline modes and still unmounts on unload", async () => {
		const { plugin, cleanup } = createPlugin("sidebar");
		initFilePatcher(plugin as any);

		try {
			const view = new (MarkdownView as any)();
			const file = new (TFile as any)();
			file.path = "notes/beta.md";

			await view.onLoadFile(file);
			await view.onUnloadFile(file);

			expect(getActiveInlineContainerSpy).not.toHaveBeenCalled();
			expect(
				plugin.componentController.unmountViewComponents,
			).toHaveBeenCalledTimes(1);
			expect(
				plugin.componentController.unmountViewComponents,
			).toHaveBeenCalledWith(view);
		} finally {
			cleanup();
		}
	});
});
