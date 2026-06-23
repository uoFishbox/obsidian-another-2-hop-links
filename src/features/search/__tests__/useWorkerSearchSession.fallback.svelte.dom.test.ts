import { render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import UseWorkerSearchSessionHarness from "./UseWorkerSearchSessionHarness.svelte";
import { buildSearchWorkerItemSnapshot } from "../searchSnapshotBuilders";

vi.mock("../useFileContentIndex.svelte.js", () => ({
	useFileContentIndex: () => ({
		hasMatch: vi.fn(() => false),
		isLoading: vi.fn(() => false),
		getFirstMatchPosition: vi.fn(() => undefined),
		forEachEntry: vi.fn(() => {}),
		getSerializableEntries: vi.fn(() => []),
	}),
}));

describe("useWorkerSearchSession fallback", () => {
	it("works with fallback filter when worker is unavailable", async () => {
		const originalWorker = globalThis.Worker;
		// Worker 未対応環境では client が同期 fallback を使う
		Reflect.set(globalThis, "Worker", undefined);

		try {
			render(UseWorkerSearchSessionHarness, {
				props: {
					app: {} as never,
					query: "alpha",
					enabled: true,
					files: [],
					dataset: [
						buildSearchWorkerItemSnapshot("alpha", "alpha note", null),
						buildSearchWorkerItemSnapshot("beta", "beta note", null),
					],
				},
			});

			await waitFor(() => {
				expect(screen.getByTestId("matched-state")).toHaveTextContent("alpha");
			});
		} finally {
			Reflect.set(globalThis, "Worker", originalWorker);
		}
	});
});
