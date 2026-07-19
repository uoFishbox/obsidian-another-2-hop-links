import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "features/settings/model";

const { createdStores, MockApplicationStore } = vi.hoisted(() => {
	class Store {
		readonly destroy = vi.fn();
		readonly handleDataUpdate = vi.fn();
		readonly subscribeToDataUpdates = vi.fn();

		constructor() {
			created.push(this);
		}
	}
	const created: Store[] = [];
	return { createdStores: created, MockApplicationStore: Store };
});

vi.mock("ui/stores/ApplicationStore.svelte", () => ({
	ApplicationStore: MockApplicationStore,
}));

import {
	ApplicationStorePool,
	RECENT_APPLICATION_STORE_LIMIT,
} from "../ApplicationStorePool";

function createPool() {
	const builders: Array<() => void> = [];
	const createDisplayDataBuilder = vi.fn(() => {
		const builder = vi.fn();
		builders.push(builder);
		return builder;
	});
	const onDataUpdate = vi.fn(() => vi.fn());
	const pool = new ApplicationStorePool({
		indexingService: { onDataUpdate } as never,
		createDisplayDataBuilder: createDisplayDataBuilder as never,
		updateSortOption: vi.fn(),
	});
	return { builders, createDisplayDataBuilder, onDataUpdate, pool };
}

describe("ApplicationStorePool", () => {
	beforeEach(() => {
		createdStores.length = 0;
	});

	it("reuses an acquired store until its idle entry is cleared", () => {
		const { pool } = createPool();
		const builder = vi.fn();
		const resolver = vi.fn();

		const first = pool.acquire(
			"leaf-1",
			"notes/alpha.md",
			DEFAULT_SETTINGS,
			builder as never,
			resolver as never,
		);
		const second = pool.acquire(
			"leaf-1",
			"notes/alpha.md",
			DEFAULT_SETTINGS,
			builder as never,
			resolver as never,
		);

		expect(second).toBe(first);
		expect(createdStores).toHaveLength(1);
		pool.release("leaf-1", "notes/alpha.md");
		pool.clearIdleStore("leaf-1", "notes/alpha.md");
		expect(createdStores[0].destroy).not.toHaveBeenCalled();

		pool.release("leaf-1", "notes/alpha.md");
		pool.clearIdleStore("leaf-1", "notes/alpha.md");
		expect(createdStores[0].destroy).toHaveBeenCalledTimes(1);
	});

	it("evicts the least recently used idle store", () => {
		const { pool } = createPool();
		const builder = vi.fn();
		const resolver = vi.fn();

		for (let index = 0; index < RECENT_APPLICATION_STORE_LIMIT + 1; index += 1) {
			const path = `notes/${index}.md`;
			pool.acquire(
				"leaf-1",
				path,
				DEFAULT_SETTINGS,
				builder as never,
				resolver as never,
			);
			pool.release("leaf-1", path);
		}

		expect(createdStores[0].destroy).toHaveBeenCalledTimes(1);
		for (const store of createdStores.slice(1)) {
			expect(store.destroy).not.toHaveBeenCalled();
		}
	});

	it("releases the leaf builder after its last store is removed", () => {
		const { createDisplayDataBuilder, pool } = createPool();
		const firstBuilder = pool.getOrCreateDisplayDataBuilder("leaf-1");
		pool.acquire(
			"leaf-1",
			"notes/alpha.md",
			DEFAULT_SETTINGS,
			firstBuilder,
			vi.fn() as never,
		);
		pool.release("leaf-1", "notes/alpha.md");
		pool.clearIdleStore("leaf-1", "notes/alpha.md");

		const nextBuilder = pool.getOrCreateDisplayDataBuilder("leaf-1");
		expect(nextBuilder).not.toBe(firstBuilder);
		expect(createDisplayDataBuilder).toHaveBeenCalledTimes(2);
	});
});
