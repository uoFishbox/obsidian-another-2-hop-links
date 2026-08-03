import { describe, expect, test, vi } from "vitest";
import {
	IndexWriteCoordinator,
	type IndexWriteExecutor,
	type RebuildExecutionContext,
} from "../index-service/IndexWriteCoordinator";

interface Deferred {
	readonly promise: Promise<void>;
	resolve(): void;
}

function createDeferred(): Deferred {
	let resolvePromise: () => void = () => {};
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: resolvePromise };
}

async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

function createExecutor(
	overrides: Partial<IndexWriteExecutor> = {},
): IndexWriteExecutor {
	return {
		applyIncremental: vi.fn(async () => undefined),
		rebuild: vi.fn(async () => undefined),
		...overrides,
	};
}

describe("IndexWriteCoordinator", () => {
	test("coalesces pending incremental changes into one batch", async () => {
		const executor = createExecutor();
		const coordinator = new IndexWriteCoordinator(executor);

		const first = coordinator.enqueueIncremental([
			{ type: "modify", path: "notes/a.md" },
		]);
		const second = coordinator.enqueueIncremental([
			{ type: "modify", path: "notes/a.md" },
			{ type: "create", path: "notes/b.md" },
		]);

		await Promise.all([first, second]);

		expect(executor.applyIncremental).toHaveBeenCalledTimes(1);
		expect(executor.applyIncremental).toHaveBeenCalledWith(
			[
				{ type: "modify", path: "notes/a.md" },
				{ type: "create", path: "notes/b.md" },
			],
			{},
		);
	});

	test("a pending rebuild absorbs incremental changes queued before it", async () => {
		const executor = createExecutor();
		const coordinator = new IndexWriteCoordinator(executor);

		const incremental = coordinator.enqueueIncremental([
			{ type: "modify", path: "notes/a.md" },
		]);
		const rebuild = coordinator.enqueueRebuild("settings-change");

		await Promise.all([incremental, rebuild]);

		expect(executor.applyIncremental).not.toHaveBeenCalled();
		expect(executor.rebuild).toHaveBeenCalledTimes(1);
	});

	test("holds changes observed during a rebuild for a catch-up batch", async () => {
		const releaseRebuild = createDeferred();
		const callOrder: string[] = [];
		const executor = createExecutor({
			rebuild: vi.fn(async () => {
				callOrder.push("rebuild:start");
				await releaseRebuild.promise;
				callOrder.push("rebuild:end");
			}),
			applyIncremental: vi.fn(async () => {
				callOrder.push("incremental");
			}),
		});
		const coordinator = new IndexWriteCoordinator(executor);

		const rebuild = coordinator.enqueueRebuild("initial-scan");
		await flushMicrotasks();
		const catchUp = coordinator.enqueueIncremental([
			{ type: "create", path: "notes/during-rebuild.md" },
		]);
		await flushMicrotasks();

		expect(executor.applyIncremental).not.toHaveBeenCalled();

		releaseRebuild.resolve();
		await Promise.all([rebuild, catchUp]);

		expect(callOrder).toEqual(["rebuild:start", "rebuild:end", "incremental"]);
	});

	test("never executes more than one writer", async () => {
		const releaseFirst = createDeferred();
		let activeWriters = 0;
		let maxActiveWriters = 0;
		const enterWriter = (): void => {
			activeWriters++;
			maxActiveWriters = Math.max(maxActiveWriters, activeWriters);
		};
		const leaveWriter = (): void => {
			activeWriters--;
		};
		const executor = createExecutor({
			applyIncremental: vi.fn(async () => {
				enterWriter();
				await releaseFirst.promise;
				leaveWriter();
			}),
			rebuild: vi.fn(async () => {
				enterWriter();
				leaveWriter();
			}),
		});
		const coordinator = new IndexWriteCoordinator(executor);

		const incremental = coordinator.enqueueIncremental([
			{ type: "modify", path: "notes/a.md" },
		]);
		await flushMicrotasks();
		const rebuild = coordinator.enqueueRebuild("requested");
		await flushMicrotasks();

		expect(executor.rebuild).not.toHaveBeenCalled();
		releaseFirst.resolve();
		await Promise.all([incremental, rebuild]);

		expect(maxActiveWriters).toBe(1);
	});

	test("aborts and marks an active rebuild stale when a newer rebuild is requested", async () => {
		const committedGenerations: number[] = [];
		let firstContext: RebuildExecutionContext | undefined;
		const executor = createExecutor({
			rebuild: vi.fn(async (context) => {
				if (!firstContext) {
					firstContext = context;
					await new Promise<void>((resolve) => {
						context.options.signal?.addEventListener(
							"abort",
							() => resolve(),
							{
								once: true,
							},
						);
					});
				}
				if (context.isCurrent()) {
					committedGenerations.push(context.generation);
				}
			}),
		});
		const coordinator = new IndexWriteCoordinator(executor);

		const first = coordinator.enqueueRebuild("initial-scan");
		await flushMicrotasks();
		const second = coordinator.enqueueRebuild("settings-change");

		expect(firstContext?.isCurrent()).toBe(false);
		expect(firstContext?.options.signal?.aborted).toBe(true);
		await Promise.all([first, second]);

		expect(executor.rebuild).toHaveBeenCalledTimes(2);
		expect(committedGenerations).toEqual([2]);
	});
});
