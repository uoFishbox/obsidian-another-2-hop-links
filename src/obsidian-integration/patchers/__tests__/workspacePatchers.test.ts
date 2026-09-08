import { describe, expect, test, vi } from "vitest";
import type { PluginHost } from "obsidian-integration/pluginHost";

const {
	hasAnyPreCreationBootstrapState,
	setPendingPreCreationBootstrapState,
	setPersistedPreCreationBootstrapState,
} = vi.hoisted(() => ({
	hasAnyPreCreationBootstrapState: vi.fn(() => false),
	setPendingPreCreationBootstrapState: vi.fn(),
	setPersistedPreCreationBootstrapState: vi.fn(),
}));

vi.mock("two-hop/pre-creation/PreCreationView", () => ({
	PRE_CREATION_EPHEMERAL_STATE_KEY: "pre-creation",
	VIEW_TYPE_PRE_CREATE: "pre-creation-view",
	hasAnyPreCreationBootstrapState,
	setPendingPreCreationBootstrapState,
	setPersistedPreCreationBootstrapState,
}));

vi.mock("obsidian-integration/files/resolveExpectedPath", () => ({
	resolveExpectedPath: vi.fn(() => "missing.md"),
}));

import { initWorkspacePatcher } from "../workspacePatchers";

describe("workspacePatchers", () => {
	test("opens the pre-creation view for an unresolved link without checking backlink count", async () => {
		const originalOpenLinkText = vi.fn();
		const leaf = {
			getEphemeralState: vi.fn(() => ({})),
			setEphemeralState: vi.fn(),
			setViewState: vi.fn(async () => undefined),
		};
		const workspace = {
			onLayoutReady: vi.fn((callback: () => void) => callback()),
			on: vi.fn(),
			openLinkText: originalOpenLinkText,
			getLeaf: vi.fn(() => leaf),
			revealLeaf: vi.fn(),
			iterateAllLeaves: vi.fn(),
		};
		const plugin = {
			app: {
				workspace,
				metadataCache: {
					getFirstLinkpathDest: vi.fn(() => null),
				},
				vault: {
					on: vi.fn(),
				},
			},
			settings: {
				enableUnresolvedLinkModal: true,
			},
			register: vi.fn(),
			registerEvent: vi.fn(),
		};

		initWorkspacePatcher(plugin as unknown as PluginHost);
		await workspace.openLinkText("missing", "source.md");

		expect(leaf.setViewState).toHaveBeenCalledWith(
			{
				type: "pre-creation-view",
				state: {
					linktext: "missing",
					sourcePath: "source.md",
					expectedPath: "missing.md",
					creationPath: "missing.md",
				},
			},
			expect.any(Object),
		);
		expect(originalOpenLinkText).not.toHaveBeenCalled();
	});
});
