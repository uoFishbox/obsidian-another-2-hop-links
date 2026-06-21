export class IndexingRunState {
	private indexingPromise: Promise<void> = Promise.resolve();
	private resolveIndexingPromise: () => void = () => {};
	private activeRuns = 0;
	private readonly externalIdleWaiters = new Set<() => Promise<void>>();

	public async awaitIdle(): Promise<void> {
		for (;;) {
			const currentIndexingPromise = this.indexingPromise;
			await currentIndexingPromise;

			const externalIdleWaiterPromises: Promise<void>[] = [];
			for (const waiter of this.externalIdleWaiters) {
				externalIdleWaiterPromises.push(waiter());
			}
			if (externalIdleWaiterPromises.length > 0) {
				await Promise.all(externalIdleWaiterPromises);
			}

			if (currentIndexingPromise === this.indexingPromise) {
				return;
			}
		}
	}

	public registerIdleWaiter(waiter: () => Promise<void>): () => void {
		this.externalIdleWaiters.add(waiter);
		return () => {
			this.externalIdleWaiters.delete(waiter);
		};
	}

	public begin(): void {
		if (this.activeRuns++ === 0) {
			this.indexingPromise = new Promise((resolve) => {
				this.resolveIndexingPromise = resolve;
			});
		}
	}

	public end(): void {
		if (this.activeRuns === 0) {
			return;
		}

		this.activeRuns -= 1;
		if (this.activeRuns === 0) {
			this.resolveIndexingPromise();
		}
	}
}
