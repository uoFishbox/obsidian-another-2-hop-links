import { describe, expect, it, vi } from "vitest";
import { createLinkStatusService } from "../linkStatusService";
import type { IndexingService } from "core/indexing/index-service/IndexingService";
import { DEFAULT_SETTINGS, type PluginSettings } from "features/settings/model";

type DataUpdateListener = () => void;

type IndexingServiceLike = Pick<
	IndexingService,
	| "isUnresolvedWithSingleBacklink"
	| "isUnresolvedWithSingleBacklinkBatch"
	| "onDataUpdate"
>;

function createIndexingService(batchResults: Map<string, boolean> = new Map()): {
	service: IndexingServiceLike;
	emitDataUpdate: () => void;
} {
	let listener: DataUpdateListener | undefined;
	const service: IndexingServiceLike = {
		isUnresolvedWithSingleBacklink: vi.fn((path: string) => {
			return batchResults.get(path) ?? false;
		}),
		isUnresolvedWithSingleBacklinkBatch: vi.fn((paths: string[]) => {
			return new Map(
				paths.map((path) => [path, batchResults.get(path) ?? false]),
			);
		}),
		onDataUpdate: vi.fn((nextListener) => {
			listener = nextListener;
			return vi.fn();
		}),
	};

	return {
		service,
		emitDataUpdate: () => {
			listener?.();
		},
	};
}

function createSettings(enableUnresolvedLinkDecoration: boolean): PluginSettings {
	return {
		...DEFAULT_SETTINGS,
		enableUnresolvedLinkDecoration,
	};
}

describe("LinkStatusService", () => {
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
		expect(indexingService.isUnresolvedWithSingleBacklink).toHaveBeenCalledTimes(1);
	});

	it("clears cached results when index data updates", () => {
		const results = new Map([["missing.md", true]]);
		const { service: indexingService, emitDataUpdate } =
			createIndexingService(results);
		const linkStatusService = createLinkStatusService(
			indexingService as IndexingService,
			() => createSettings(true),
		);

		expect(linkStatusService.shouldDecorateLink("missing.md")).toBe(true);
		results.set("missing.md", false);
		emitDataUpdate();

		expect(linkStatusService.shouldDecorateLink("missing.md")).toBe(false);
		expect(indexingService.isUnresolvedWithSingleBacklink).toHaveBeenCalledTimes(2);
	});

	it("queries only uncached paths during batch decoration checks", () => {
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

		expect(linkStatusService.shouldDecorateLink("cached.md")).toBe(true);
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
		).toHaveBeenCalledWith(["fresh.md"]);
	});
});
