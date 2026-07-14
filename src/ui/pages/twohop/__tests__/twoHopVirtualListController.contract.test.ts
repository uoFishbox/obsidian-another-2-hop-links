import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createTwoHopVirtualListController } from "../twoHopVirtualListController.svelte";
import { useTwoHopViewPlanVirtualList } from "../useTwoHopVirtualListSurface.svelte";

const twoHopRoot = dirname(dirname(fileURLToPath(import.meta.url)));

describe("two-hop virtual-list controller boundary", () => {
	it("keeps the legacy hook as a compatibility alias", () => {
		expect(useTwoHopViewPlanVirtualList).toBe(createTwoHopVirtualListController);
	});

	it("composes production state without the legacy runtime relay modules", () => {
		const controllerSource = readFileSync(
			join(twoHopRoot, "twoHopVirtualListController.svelte.ts"),
			"utf8",
		);
		const surfaceSource = readFileSync(
			join(twoHopRoot, "TwoHopVirtualListSurface.svelte"),
			"utf8",
		);
		const legacyModules = [
			"twoHopVirtualListPlanRuntime",
			"twoHopMountedSurfaceRuntime",
			"twoHopMeasurementBridge",
		];

		for (const moduleName of legacyModules) {
			expect(controllerSource).not.toContain(`from "./${moduleName}`);
			expect(surfaceSource).not.toContain(`from "./${moduleName}`);
			const compatibilitySource = readFileSync(
				join(twoHopRoot, `${moduleName}.svelte.ts`),
				"utf8",
			);
			expect(compatibilitySource).toContain("@deprecated");
		}
		for (const moduleName of [
			"twoHopVirtualListInputRuntime",
			"twoHopVirtualListMountedRuntime",
			"twoHopVirtualListMeasurementRuntime",
		]) {
			expect(controllerSource).toContain(`from "./${moduleName}`);
		}
		expect(surfaceSource).toContain('from "./twoHopVirtualListController.svelte"');
	});
});
