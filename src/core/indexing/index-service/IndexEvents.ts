export interface DataUpdateContext {
	affectsAll?: boolean;
	affectedPaths?: string[];
	affectedLookupKeys?: string[];
	affectedTags?: string[];

	/**
	 * Outgoing link summary が変化した source file paths.
	 * 本文だけの変更では入れない.
	 */
	affectedLinkSourcePaths?: string[];

	/**
	 * Tag membership が変化した source file paths.
	 * 本文だけの変更では入れない.
	 */
	affectedTagSourcePaths?: string[];
}

export type DataUpdateListener = (context: DataUpdateContext) => void;
