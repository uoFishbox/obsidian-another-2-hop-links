import type {
	IncrementalFileChange,
	RebuildOptions,
	TimeSlicingOptions,
} from "../types/IndexTypes";

export type RebuildReason =
	| "requested"
	| "initial-scan"
	| "settings-change"
	| "incremental-recovery";

export interface RebuildExecutionContext {
	readonly reason: RebuildReason;
	readonly options: RebuildOptions;
	readonly generation: number;
	isCurrent(): boolean;
}

export interface IndexWriteExecutor {
	applyIncremental(
		changes: IncrementalFileChange[],
		options: TimeSlicingOptions,
	): Promise<void>;
	rebuild(context: RebuildExecutionContext): Promise<void>;
}

interface DeferredWrite {
	readonly promise: Promise<void>;
	resolve(): void;
	reject(error: unknown): void;
}

interface PendingRebuild {
	reason: RebuildReason;
	options: RebuildOptions;
	generation: number;
	waiters: DeferredWrite[];
}

interface ActiveRebuild extends PendingRebuild {
	readonly abortController: AbortController;
	readonly removeExternalAbortListener: () => void;
	superseded: boolean;
}

/** Serializes all index mutations and coalesces writes waiting for execution. */
export class IndexWriteCoordinator {
	private pendingIncrementalChanges: IncrementalFileChange[] = [];
	private pendingIncrementalOptions: TimeSlicingOptions = {};
	private pendingIncrementalWaiters: DeferredWrite[] = [];
	private pendingRebuild: PendingRebuild | undefined;
	private activeRebuild: ActiveRebuild | undefined;
	private processScheduled = false;
	private processing = false;
	private rebuildGeneration = 0;
	private idle = true;
	private activityGeneration = 0;
	private idlePromise: Promise<void> = Promise.resolve();
	private resolveIdle: () => void = () => {};

	public constructor(private readonly executor: IndexWriteExecutor) {}

	public enqueueIncremental(
		changes: IncrementalFileChange[],
		options: TimeSlicingOptions = {},
	): Promise<void> {
		if (changes.length === 0) {
			return Promise.resolve();
		}

		this.markBusy();
		this.pendingIncrementalChanges.push(...changes);
		this.pendingIncrementalOptions = options;
		const deferred = createDeferredWrite();
		this.pendingIncrementalWaiters.push(deferred);
		this.scheduleProcessing();
		return deferred.promise;
	}

	public enqueueRebuild(
		reason: RebuildReason,
		options: RebuildOptions = {},
	): Promise<void> {
		this.markBusy();
		const deferred = createDeferredWrite();
		const generation = ++this.rebuildGeneration;
		const waiters = this.pendingRebuild?.waiters ?? [];

		if (this.activeRebuild && !this.activeRebuild.superseded) {
			this.activeRebuild.superseded = true;
			this.activeRebuild.abortController.abort();
			waiters.push(...this.activeRebuild.waiters);
			this.activeRebuild.waiters = [];
		}

		if (this.pendingIncrementalWaiters.length > 0) {
			this.pendingIncrementalChanges = [];
			waiters.push(...this.pendingIncrementalWaiters);
			this.pendingIncrementalWaiters = [];
			this.pendingIncrementalOptions = {};
		}

		waiters.push(deferred);
		this.pendingRebuild = {
			reason,
			options,
			generation,
			waiters,
		};
		this.scheduleProcessing();
		return deferred.promise;
	}

	public async awaitIdle(): Promise<void> {
		for (;;) {
			const currentIdlePromise = this.idlePromise;
			await currentIdlePromise;
			if (this.idle && currentIdlePromise === this.idlePromise) {
				return;
			}
		}
	}

	/** Returns the current writer activity generation for idle coordination. */
	public getActivityGeneration(): number {
		return this.activityGeneration;
	}

	/** Returns whether no writer activity started since the supplied generation. */
	public isIdleAtActivityGeneration(generation: number): boolean {
		return this.idle && generation === this.activityGeneration;
	}

	private scheduleProcessing(): void {
		if (this.processScheduled || this.processing) {
			return;
		}

		this.processScheduled = true;
		queueMicrotask(() => {
			this.processScheduled = false;
			void this.processWrites();
		});
	}

	private async processWrites(): Promise<void> {
		if (this.processing) {
			return;
		}

		this.processing = true;
		try {
			while (this.hasPendingWrites()) {
				if (this.pendingRebuild) {
					await this.processRebuild();
					continue;
				}
				await this.processIncremental();
			}
		} finally {
			this.processing = false;
			if (this.hasPendingWrites()) {
				this.scheduleProcessing();
			} else {
				this.markIdle();
			}
		}
	}

	private async processRebuild(): Promise<void> {
		const pending = this.pendingRebuild;
		if (!pending) {
			return;
		}

		this.pendingRebuild = undefined;
		const abortController = new AbortController();
		const externalSignal = pending.options.signal;
		const abortFromExternalSignal = (): void => {
			abortController.abort();
		};
		if (externalSignal?.aborted) {
			abortController.abort();
		} else {
			externalSignal?.addEventListener("abort", abortFromExternalSignal, {
				once: true,
			});
		}
		const active: ActiveRebuild = {
			...pending,
			abortController,
			removeExternalAbortListener: () => {
				externalSignal?.removeEventListener("abort", abortFromExternalSignal);
			},
			superseded: false,
		};
		this.activeRebuild = active;

		try {
			await this.executor.rebuild({
				reason: active.reason,
				options: {
					...active.options,
					signal: active.abortController.signal,
				},
				generation: active.generation,
				isCurrent: () => active.generation === this.rebuildGeneration,
			});
			if (!active.superseded) {
				resolveWrites(active.waiters);
			}
		} catch (error) {
			if (!active.superseded) {
				rejectWrites(active.waiters, error);
			}
		} finally {
			active.removeExternalAbortListener();
			if (this.activeRebuild === active) {
				this.activeRebuild = undefined;
			}
		}
	}

	private async processIncremental(): Promise<void> {
		const changes = this.pendingIncrementalChanges;
		const options = this.pendingIncrementalOptions;
		const waiters = this.pendingIncrementalWaiters;
		this.pendingIncrementalChanges = [];
		this.pendingIncrementalOptions = {};
		this.pendingIncrementalWaiters = [];

		if (changes.length === 0) {
			resolveWrites(waiters);
			return;
		}

		try {
			await this.executor.applyIncremental(changes, options);
			resolveWrites(waiters);
		} catch (error) {
			rejectWrites(waiters, error);
		}
	}

	private hasPendingWrites(): boolean {
		return Boolean(
			this.pendingRebuild || this.pendingIncrementalWaiters.length > 0,
		);
	}

	private markBusy(): void {
		if (!this.idle) {
			return;
		}

		this.idle = false;
		this.activityGeneration++;
		this.idlePromise = new Promise((resolve) => {
			this.resolveIdle = resolve;
		});
	}

	private markIdle(): void {
		if (this.idle) {
			return;
		}

		this.idle = true;
		this.resolveIdle();
	}
}

function createDeferredWrite(): DeferredWrite {
	let resolvePromise: () => void = () => {};
	let rejectPromise: (error: unknown) => void = () => {};
	const promise = new Promise<void>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return {
		promise,
		resolve: resolvePromise,
		reject: rejectPromise,
	};
}

function resolveWrites(writes: DeferredWrite[]): void {
	for (const write of writes) {
		write.resolve();
	}
}

function rejectWrites(writes: DeferredWrite[], error: unknown): void {
	for (const write of writes) {
		write.reject(error);
	}
}
