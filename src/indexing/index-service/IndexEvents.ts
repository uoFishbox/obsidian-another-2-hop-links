/**
 * Unique values carried by an index update event.
 *
 * Indexing stages use Set instances for uniqueness.  The event boundary accepts
 * both Sets and arrays so internal callers can avoid rebuilding a Set while
 * existing listener payloads remain serializable.
 */
export type DataUpdateCollection = ReadonlySet<string> | readonly string[];

export interface DataUpdateContext {
	affectsAll?: boolean;
	affectedPaths?: DataUpdateCollection;
	affectedLookupKeys?: DataUpdateCollection;
	affectedTags?: DataUpdateCollection;

	/**
	 * Source file paths whose outgoing-link summaries changed.
	 * Not included for body-only changes.
	 */
	affectedLinkSourcePaths?: DataUpdateCollection;

	/**
	 * Source file paths whose tag membership changed.
	 * Not included for body-only changes.
	 */
	affectedTagSourcePaths?: DataUpdateCollection;
}

export type DataUpdateListener = (context: DataUpdateContext) => void;

/** Returns the number of unique values in an event collection. */
export function dataUpdateCollectionSize(
	values: DataUpdateCollection | undefined,
): number {
	if (!values) return 0;
	return isReadonlySet(values) ? values.size : values.length;
}

/** Checks a collection without materializing a Set for array input. */
export function dataUpdateCollectionHas(
	values: DataUpdateCollection | undefined,
	value: string,
): boolean {
	if (!values) return false;
	return isReadonlySet(values) ? values.has(value) : values.includes(value);
}

/** Reuses Set input and only allocates when an array/iterable needs adapting. */
export function toDataUpdateSet(
	values: Iterable<string> | undefined,
): ReadonlySet<string> | undefined {
	if (!values) return undefined;
	return isReadonlySet(values) ? values : new Set(values);
}

function isReadonlySet(values: unknown): values is ReadonlySet<string> {
	return (
		typeof values === "object" &&
		values !== null &&
		typeof (values as ReadonlySet<string>).has === "function" &&
		typeof (values as ReadonlySet<string>).size === "number"
	);
}
