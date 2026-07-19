import { describe, expect, it } from "vitest";
import { createSurfaceVirtualCellRegistry } from "../VirtualCellRegistry";

describe("surface virtual cell registry", () => {
	it("rebinds one DOM slot without retaining its previous logical key", () => {
		const registry = createSurfaceVirtualCellRegistry();
		const element = document.createElement("div");
		const child = document.createElement("button");
		element.append(child);
		const registration = registry.createRegistration(element);

		registration.update("cell-a", 1, 0);
		expect(registry.findByKey("cell-a")).toBe(element);
		expect(registry.findClosest(child)?.metadata).toEqual({
			logicalKey: "cell-a",
			rowIndex: 1,
			columnIndex: 0,
		});

		registration.update("cell-b", 2, 1);
		expect(registry.findByKey("cell-a")).toBeNull();
		expect(registry.findByKey("cell-b")).toBe(element);

		registration.unregister();
		expect(registry.findByKey("cell-b")).toBeNull();
		expect(registry.findClosest(child)).toBeNull();
	});

	it("does not let a stale registration remove a newer unique binding", () => {
		const registry = createSurfaceVirtualCellRegistry();
		const oldElement = document.createElement("div");
		const newElement = document.createElement("div");
		const oldRegistration = registry.createRegistration(oldElement);
		const newRegistration = registry.createRegistration(newElement);

		oldRegistration.update("cell", 0, 0);
		newRegistration.update("cell", 0, 0);
		oldRegistration.unregister();

		expect(registry.findByKey("cell")).toBe(newElement);
	});
});
