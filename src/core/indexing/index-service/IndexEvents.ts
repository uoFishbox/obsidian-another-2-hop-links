export interface DataUpdateContext {
	indexVersion: number;
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

	/**
	 * Markdown 本文 が変化した source file paths.
	 */
	affectedSourceContentPaths?: string[];

	/**
	 * Link index (backlink / unresolved / lookup graph) に意味的差分があったか.
	 */
	linkIndexChanged?: boolean;

	/**
	 * Tag index に意味的差分があったか.
	 */
	tagIndexChanged?: boolean;

	/**
	 * Source document の内容に変更があったか.
	 */
	sourceContentChanged?: boolean;
}

export type DataUpdateListener = (context: DataUpdateContext) => void;
