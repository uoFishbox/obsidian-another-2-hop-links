import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getActiveInlineContainerSpy } = vi.hoisted(() => ({
	getActiveInlineContainerSpy: vi.fn(),
}));

vi.mock("shared/ui/dom/domUtils", () => ({
	getActiveInlineContainer: getActiveInlineContainerSpy,
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
import { initFilePatcher } from "../MarkdownViewPatcher";

function createPlugin(displayMode: "editor-inline" | "hybrid" | "sidebar") {
	const unregisterCallbacks: Array<() => void> = [];
	const plugin = {
		settings: {
			displayMode,
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
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

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
