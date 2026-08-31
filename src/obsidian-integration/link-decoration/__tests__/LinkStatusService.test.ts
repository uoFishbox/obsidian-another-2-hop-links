import { describe, expect, it, vi } from "vitest";
import { createLinkStatusService } from "../linkStatusService";
import type { IndexingService } from "indexing/index-service/IndexingService";
import { DEFAULT_SETTINGS, type PluginSettings } from "settings/model";

type IndexingServiceLike = Pick<
	IndexingService,
	"isReady" | "isUnresolvedWithSingleBacklink" | "isUnresolvedWithSingleBacklinkBatch"
>;

function createIndexingService(
	batchResults: Map<string, boolean> = new Map(),
	ready = true,
): {
	service: IndexingServiceLike;
} {
	const service: IndexingServiceLike = {
		isReady: vi.fn(() => ready),
		isUnresolvedWithSingleBacklink: vi.fn((path: string) => {
			return batchResults.get(path) ?? false;
		}),
		isUnresolvedWithSingleBacklinkBatch: vi.fn((paths: string[]) => {
			return new Map(
				paths.map((path) => [path, batchResults.get(path) ?? false]),
			);
		}),
	};

	return { service };
}

function createSettings(enableUnresolvedLinkDecoration: boolean): PluginSettings {
	return {
		...DEFAULT_SETTINGS,
		enableUnresolvedLinkDecoration,
	};
}

describe("LinkStatusService", () => {
	it("returns neutral results without querying the index before it is ready", () => {
		const { service: indexingService } = createIndexingService(
			new Map([["missing.md", true]]),
			false,
		);
		const linkStatusService = createLinkStatusService(
			indexingService as IndexingService,
			() => createSettings(true),
		);

		expect(linkStatusService.shouldDecorateLink("missing.md")).toBe(false);
		expect(linkStatusService.shouldDecorateLinkBatch(["missing.md"])).toEqual(
			new Map(),
		);
		expect(linkStatusService.isUnresolvedWithSingleBacklink("missing.md")).toBe(
			false,
		);
		expect(indexingService.isUnresolvedWithSingleBacklink).not.toHaveBeenCalled();
		expect(
			indexingService.isUnresolvedWithSingleBacklinkBatch,
		).not.toHaveBeenCalled();
	});

	it("returns an empty batch result without querying the index when decoration is disabled", () => {
		const { service: indexingService } = createIndexingService(
			new Map([["missing.md", true]]),
		);
		const linkStatusService = createLinkStatusService(
			indexingService as IndexingService,
			() => createSettings(false),
		);

		const result = linkStatusService.shouldDecorateLinkBatch(["missing.md"]);

		expect(result.size).toBe(0);
		expect(
			indexingService.isUnresolvedWithSingleBacklinkBatch,
		).not.toHaveBeenCalled();
	});

	it("clears cached results when the decoration setting changes", () => {
		let decorationEnabled = true;
		const { service: indexingService } = createIndexingService(
			new Map([["missing.md", true]]),
		);
		const linkStatusService = createLinkStatusService(
			indexingService as IndexingService,
			() => createSettings(decorationEnabled),
		);

		expect(linkStatusService.shouldDecorateLink("missing.md")).toBe(true);
		expect(linkStatusService.shouldDecorateLink("missing.md")).toBe(true);
		decorationEnabled = false;

		expect(linkStatusService.shouldDecorateLink("missing.md")).toBe(false);
		expect(indexingService.isUnresolvedWithSingleBacklink).toHaveBeenCalledTimes(2);
	});

	it("defers to the index for every lookup", () => {
		const results = new Map([["missing.md", true]]);
		const { service: indexingService } = createIndexingService(results);
		const linkStatusService = createLinkStatusService(
			indexingService as IndexingService,
			() => createSettings(true),
		);

		expect(linkStatusService.shouldDecorateLink("missing.md")).toBe(true);
		results.set("missing.md", false);

		expect(linkStatusService.shouldDecorateLink("missing.md")).toBe(false);
		expect(indexingService.isUnresolvedWithSingleBacklink).toHaveBeenCalledTimes(2);
	});

	it("checks every path via the batch API", () => {
		const { service: indexingService } = createIndexingService(
			new Map([
				["cached.md", true],
				["fresh.md", false],
			]),
		);
		const linkStatusService = createLinkStatusService(
			indexingService as IndexingService,
			() => createSettings(true),
		);

		const result = linkStatusService.shouldDecorateLinkBatch([
			"cached.md",
			"fresh.md",
		]);

		expect(result).toEqual(
			new Map([
				["cached.md", true],
				["fresh.md", false],
			]),
		);
		expect(
			indexingService.isUnresolvedWithSingleBacklinkBatch,
		).toHaveBeenCalledWith(["cached.md", "fresh.md"]);
	});
});
