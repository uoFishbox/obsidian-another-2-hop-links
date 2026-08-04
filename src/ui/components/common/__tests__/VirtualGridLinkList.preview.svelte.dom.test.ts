import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { DEFAULT_SETTINGS } from "features/settings/model";
import { createPreviewRenderSettings } from "features/card-preview/core/previewRenderSettings";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { AppContext, LinkContext } from "ui/context/linkContext";
import type { ViewItem } from "application/presenters";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";
import {
	flushFrames,
	installAnimationFrameMock,
	installIntersectionObserverMock,
	installResizeObserverMock,
	resetRecords,
	setElementRect,
	setNumericProperty,
	teardownAnimationFrameMock,
	teardownIntersectionObserverMock,
	teardownResizeObserverMock,
	triggerResize,
} from "testing/helpers/DOMObserverMock";
import VirtualGridPreviewHarness from "./VirtualGridPreviewHarness.svelte";
import {
	createPreviewRuntime,
	type PreviewRuntime,
} from "features/card-preview/runtime/previewRuntime";

const previewRuntimes = new Set<PreviewRuntime>();

beforeEach(() => {
	resetRecords();
	installResizeObserverMock();
	installIntersectionObserverMock();
	installAnimationFrameMock();
});

afterEach(() => {
	cleanup();
	for (const runtime of previewRuntimes) runtime.dispose();
	previewRuntimes.clear();
	teardownResizeObserverMock();
	teardownIntersectionObserverMock();
	teardownAnimationFrameMock();
});

function createModel(file: TFile): CardRenderModel {
	const item = { type: "file", data: file } as ViewItem;
	return {
		item,
		targetFile: file,
		title: file.basename,
		ariaLabel: file.basename,
		className: null,
		extension: "md",
		directory: "notes",
		interactionId: file.path,
		interactionKey: file.path,
		interactionDescriptor: null,
		presentation: undefined,
		searchQuery: "",
		previewRequest: {
			renderKey: `preview:${file.path}`,
			previewContentKey: `content:${file.path}`,
			previewCacheRevision: "0:0",
			file,
			searchQuery: "",
			previewOverride: null,
			settings: createPreviewRenderSettings(DEFAULT_SETTINGS),
		},
	};
}

describe("VirtualGridLinkList preview surface", () => {
	it("commits preview DOM without CardPreview or ViewItemCard reevaluation", async () => {
		const file = {
			path: "notes/flat.md",
			basename: "flat",
			extension: "md",
			parent: { path: "notes" },
			stat: { mtime: 1 },
		} as TFile;
		const getPreview = vi.fn(async () => ({
			type: "image" as const,
			content: "https://example.com/flat.png",
		}));
		const linkContext = {
			getPreview,
			sourceFile: file,
			fileToLinktext: () => "flat",
			getMetadata: () => null,
		} as unknown as LinkContext;
		const applicationStore = {
			settings: DEFAULT_SETTINGS,
			getPreviewRenderVersion: () => "0:0",
		} as unknown as ApplicationStore;
		const app = { vault: {} } as App;
		const previewRuntime = createPreviewRuntime({ app, getPreview });
		previewRuntimes.add(previewRuntime);
		const appContext = {
			app,
			applicationStore,
			linkContext,
			bookmarks: {
				filePaths: new Set(),
				orderedFilePaths: [],
				isBookmarked: () => false,
			},
			previewRuntime,
		} as AppContext;
		resetCCLDevMeasurements();
		const { container } = render(VirtualGridPreviewHarness, {
			props: {
				models: [createModel(file)],
				linkContext,
				appContext,
				applicationStore,
			},
		});
		const scrollRoot = container.querySelector<HTMLElement>(
			'[data-testid="scroll-root"]',
		);
		const gridRoot = container.querySelector<HTMLElement>(
			".cosense-card-links__virtual-grid",
		);
		if (!scrollRoot || !gridRoot) {
			throw new TypeError("Virtual grid test surface was not rendered");
		}
		setNumericProperty(scrollRoot, "clientHeight", 240);
		setNumericProperty(scrollRoot, "scrollTop", 0);
		setElementRect(scrollRoot, { top: 0, width: 330, height: 240 });
		gridRoot.style.setProperty("--ccl-box-size", "100px");
		gridRoot.style.setProperty("--ccl-box-height", "120px");
		gridRoot.style.setProperty("--ccl-box-gap", "10px");
		gridRoot.style.setProperty("--ccl-box-cols-max", "3");
		setElementRect(gridRoot, { top: 0, width: 330, height: 500 });
		triggerResize(gridRoot, 330, 500);
		triggerResize(scrollRoot, 330, 240);
		for (let index = 0; index < 6; index += 1) {
			await flushFrames();
			await Promise.resolve();
		}
		const host = gridRoot.shadowRoot?.querySelector<HTMLElement>(
			'[data-preview-owner="virtual-surface"]',
		);
		expect(host).not.toBeNull();
		const reevaluationsBefore =
			getCCLDevMeasurementSnapshot().counters["component.ViewItemCard.reevaluate"]
				.count;

		await waitFor(() => expect(getPreview).toHaveBeenCalled());
		for (let index = 0; index < 4; index += 1) {
			await flushFrames();
			await Promise.resolve();
		}

		expect(host?.dataset.previewState).toBe("committed");
		expect(host?.querySelector("img")).not.toBeNull();
		expect(
			getCCLDevMeasurementSnapshot().counters["component.ViewItemCard.reevaluate"]
				.count,
		).toBe(reevaluationsBefore);
	});
});
