import { describe, expect, it, vi } from "vitest";
import {
	createStableViewItemReconciler,
	type ViewItem,
} from "application/presenters";

interface RawItem {
	id?: string;
	key: string;
	label: string;
}

describe("createStableViewItemReconciler", () => {
	it("reuses ViewItem objects and the array reference when the keyed contents stay the same", () => {
		const getKey = vi.fn((item: RawItem) => item.key);
		const reconciler = createStableViewItemReconciler<RawItem>({
			getKey,
			toViewItem: (item) =>
				({
					type: "newLink",
					data: {
						rawText: item.label,
						path: item.key,
					},
				}) as ViewItem,
		});
		const alpha = { key: "alpha", label: "Alpha" };
		const beta = { key: "beta", label: "Beta" };
		const source = [alpha, beta];

		const first = reconciler.reconcile(source);
		const keys = reconciler.getKeys();
		const second = reconciler.reconcile(source);

		expect(second).toBe(first);
		expect(second[0]).toBe(first[0]);
		expect(second[1]).toBe(first[1]);
		expect(reconciler.getKeys()).toBe(keys);
		expect(keys).toEqual(["alpha", "beta"]);
		expect(getKey).toHaveBeenCalledTimes(2);
	});

	it("reuses keyed ViewItem objects when the same sources move to a different index", () => {
		const reconciler = createStableViewItemReconciler<RawItem>({
			getKey: (item) => item.key,
			toViewItem: (item) =>
				({
					type: "newLink",
					data: {
						rawText: item.label,
						path: item.key,
					},
				}) as ViewItem,
		});
		const alpha = { key: "alpha", label: "Alpha" };
		const beta = { key: "beta", label: "Beta" };

		const first = reconciler.reconcile([alpha, beta]);
		const second = reconciler.reconcile([beta, alpha]);

		expect(second).not.toBe(first);
		expect(second[0]).toBe(first[1]);
		expect(second[1]).toBe(first[0]);
	});

	it("reuses duplicate-key ViewItem objects when matching sources reorder", () => {
		const reconciler = createStableViewItemReconciler<RawItem>({
			getKey: (item) => item.key,
			toViewItem: (item) =>
				({
					type: "newLink",
					data: {
						rawText: item.label,
						path: item.key,
					},
				}) as ViewItem,
			canReuseSource: (previous, next) => previous.id === next.id,
		});
		const firstAlpha = { id: "a", key: "duplicate", label: "Alpha" };
		const firstBeta = { id: "b", key: "duplicate", label: "Beta" };

		const first = reconciler.reconcile([firstAlpha, firstBeta]);
		const second = reconciler.reconcile([firstBeta, firstAlpha]);

		expect(second).not.toBe(first);
		expect(second[0]).toBe(first[1]);
		expect(second[1]).toBe(first[0]);
	});

	it("recreates only the duplicate entry whose source can no longer be reused", () => {
		const reconciler = createStableViewItemReconciler<RawItem>({
			getKey: (item) => item.key,
			toViewItem: (item) =>
				({
					type: "newLink",
					data: {
						rawText: item.label,
						path: item.key,
					},
				}) as ViewItem,
			canReuseSource: (previous, next) =>
				previous.id === next.id && previous.label === next.label,
		});
		const alpha = { id: "a", key: "duplicate", label: "Alpha" };
		const beta = { id: "b", key: "duplicate", label: "Beta" };

		const first = reconciler.reconcile([alpha, beta]);
		const second = reconciler.reconcile([
			beta,
			{ id: "a", key: "duplicate", label: "Alpha updated" },
		]);

		expect(second[0]).toBe(first[1]);
		expect(second[1]).not.toBe(first[0]);
	});

	it("updates ViewItem data when a reusable source is replaced", () => {
		const reconciler = createStableViewItemReconciler<RawItem>({
			getKey: (item) => item.key,
			toViewItem: (item) =>
				({
					type: "newLink",
					data: {
						rawText: item.label,
						path: item.key,
					},
				}) as ViewItem,
			canReuseSource: (previous, next) => previous.id === next.id,
		});
		const first = reconciler.reconcile([
			{ id: "a", key: "alpha", label: "Alpha" },
		]);
		const second = reconciler.reconcile([
			{ id: "a", key: "alpha", label: "Alpha updated" },
		]);

		expect(second[0]).toBe(first[0]);
		expect(second[0].data).toMatchObject({
			rawText: "Alpha updated",
			path: "alpha",
		});
	});

	it("matches the correct entry when three duplicate keys are reordered", () => {
		const reconciler = createStableViewItemReconciler<RawItem>({
			getKey: (item) => item.key,
			toViewItem: (item) =>
				({
					type: "newLink",
					data: {
						rawText: item.label,
						path: item.key,
					},
				}) as ViewItem,
			canReuseSource: (previous, next) => previous.id === next.id,
		});
		const alpha = { id: "a", key: "duplicate", label: "Alpha" };
		const beta = { id: "b", key: "duplicate", label: "Beta" };
		const gamma = { id: "c", key: "duplicate", label: "Gamma" };

		const first = reconciler.reconcile([alpha, beta, gamma]);
		const second = reconciler.reconcile([gamma, alpha, beta]);

		expect(second[0]).toBe(first[2]);
		expect(second[1]).toBe(first[0]);
		expect(second[2]).toBe(first[1]);
	});
});
