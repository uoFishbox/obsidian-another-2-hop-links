import { render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type TwoHopListMode } from "features/settings/model";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { LinkContext } from "ui/context/linkContext";
import type { TwoHopPreviewDependencies } from "features/two-hop/ui/twoHopPreviewDependencies";
import type { VirtualPreviewSurface } from "features/preview/scheduling/virtualPreviewSurface";
import {
	installIntersectionObserverMock,
	installResizeObserverMock,
	resetRecords,
	teardownIntersectionObserverMock,
	teardownResizeObserverMock,
} from "testing/helpers/DOMObserverMock";
import TwoHopLinksListHarness from "./TwoHopLinksListHarness.svelte";

function createApplicationStore(mode: TwoHopListMode): ApplicationStore {
	return {
		settings: { ...DEFAULT_SETTINGS, twoHopListMode: mode },
		updateVersion: 0,
		getPreviewRenderVersion: () => "0:0",
	} as unknown as ApplicationStore;
}

beforeEach(() => {
	resetRecords();
	installResizeObserverMock();
	installIntersectionObserverMock();
});

afterEach(() => {
	teardownResizeObserverMock();
	teardownIntersectionObserverMock();
});

describe("TwoHopLinksList mode routing", () => {
	it("disposes each preview surface while switching between implementations", async () => {
		const surfaces: Array<
			VirtualPreviewSurface & { dispose: ReturnType<typeof vi.fn> }
		> = [];
		const previewDependencies = {
			previewRuntime: {
				createSurface: vi.fn(() => {
					const surface = {
						registerHost: () => ({ dispose: () => {} }),
						publish: () => {},
						dispose: vi.fn(),
					};
					surfaces.push(surface);
					return surface;
				}),
			},
			resolveSearchMatchPosition: () => undefined,
		} as unknown as TwoHopPreviewDependencies;
		const linkContext = {
			getPreview: vi.fn(),
		} as unknown as LinkContext;
		const preciseStore = createApplicationStore("precise-virtual");
		const progressiveStore = createApplicationStore("progressive-chunks");
		const props = {
			sections: [],
			applicationStore: preciseStore,
			linkContext,
			previewDependencies,
		};
		const { container, rerender } = render(TwoHopLinksListHarness, { props });

		expect(container.querySelector(".twohop-keyed-surface")).not.toBeNull();
		expect(surfaces).toHaveLength(1);

		await rerender({ ...props, applicationStore: progressiveStore });

		expect(container.querySelector(".twohop-progressive-surface")).not.toBeNull();
		expect(surfaces).toHaveLength(2);
		expect(surfaces[0].dispose).toHaveBeenCalledOnce();

		await rerender({ ...props, applicationStore: preciseStore });

		expect(container.querySelector(".twohop-keyed-surface")).not.toBeNull();
		expect(surfaces).toHaveLength(3);
		expect(surfaces[1].dispose).toHaveBeenCalledOnce();
	});
});
