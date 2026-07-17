import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const twoHopRoot = dirname(dirname(fileURLToPath(import.meta.url)));

describe("two-hop virtual-list controller boundary", () => {
	it("composes production state through the explicit runtime modules", () => {
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
