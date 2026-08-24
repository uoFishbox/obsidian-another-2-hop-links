import type { DataUpdateContext, DataUpdateListener } from "./IndexEvents";

export class IndexUpdateEmitter {
	private readonly dataUpdateListeners = new Set<DataUpdateListener>();
	private indexVersion = 0;

	public onDataUpdate(listener: DataUpdateListener): () => void {
		this.dataUpdateListeners.add(listener);
		return () => {
			this.dataUpdateListeners.delete(listener);
		};
	}

	public getIndexVersion(): number {
		return this.indexVersion;
	}

	public bumpIndexVersion(): void {
		this.indexVersion++;
	}

	public notifyDataUpdate(
		context: {
			affectsAll?: boolean;
			affectedPaths?: Iterable<string>;
			affectedLookupKeys?: Iterable<string>;
			affectedTags?: Iterable<string>;
			affectedLinkSourcePaths?: Iterable<string>;
			affectedTagSourcePaths?: Iterable<string>;
		} = {},
	): void {
		if (this.dataUpdateListeners.size === 0) {
			return;
		}

		const payload: DataUpdateContext = {
			affectsAll: context.affectsAll,
			affectedPaths: context.affectedPaths
				? Array.from(context.affectedPaths)
				: undefined,
			affectedLookupKeys: context.affectedLookupKeys
				? Array.from(context.affectedLookupKeys)
				: undefined,
			affectedTags: context.affectedTags
				? Array.from(context.affectedTags)
				: undefined,
			affectedLinkSourcePaths: context.affectedLinkSourcePaths
				? Array.from(context.affectedLinkSourcePaths)
				: undefined,
			affectedTagSourcePaths: context.affectedTagSourcePaths
				? Array.from(context.affectedTagSourcePaths)
				: undefined,
		};

		this.dataUpdateListeners.forEach((listener) => {
			try {
				listener(payload);
			} catch (error) {
				console.error("Error in data update listener:", error);
			}
		});
	}
}
