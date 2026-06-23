import type { BacklinkBucket } from "types/domain";
import type { LinkReference } from "types/domain";
import type {
	OrderedBacklinkRef,
	SourceDestinationSummary,
	SourceSummary,
} from "../types/IndexTypes";
import { createOrderedBacklinkRef } from "./backlinkReferenceSequence";
import type { ResolvedLinkInfo } from "../link-resolution/linkResolution";
import { HEAVY_YIELD_CHECK_INTERVAL, type YieldScheduler } from "../timeSlicing";

export interface FileLocalDestinationAggregate {
	count: number;
	hasResolved: boolean;
	firstRef: RepresentativeRef;
}

export interface RepresentativeRef {
	ref: OrderedBacklinkRef;
	offset: number;
	summaryIndex?: number;
}

export type RawLinkPathAccumulator = string | Set<string>;

export interface FileLocalAggregation {
	destinationBuckets: Map<string, FileLocalDestinationAggregate>;
	firstRefByLookupKey: Map<string, RepresentativeRef>;
	lookupKeyToRawLinkPaths: Map<string, RawLinkPathAccumulator>;
	unresolvedLookupKeys: Set<string>;
	hasSourceDependentLinks: boolean;
}

type SourceSummaryDestinationVisitor = (
	destinationPath: string,
	aggregate: FileLocalDestinationAggregate,
) => void;

const EMPTY_UNRESOLVED_LOOKUP_KEYS: ReadonlySet<string> = new Set<string>();

export function createFileLocalAggregation(): FileLocalAggregation {
	return {
		destinationBuckets: new Map(),
		firstRefByLookupKey: new Map(),
		lookupKeyToRawLinkPaths: new Map(),
		unresolvedLookupKeys: new Set(),
		hasSourceDependentLinks: false,
	};
}

export function resetFileLocalAggregation(scratch: FileLocalAggregation): void {
	scratch.destinationBuckets.clear();
	scratch.firstRefByLookupKey.clear();
	scratch.lookupKeyToRawLinkPaths.clear();
	scratch.unresolvedLookupKeys.clear();
	scratch.hasSourceDependentLinks = false;
}

export function recordLookupKeyRawLinkPath(
	lookupKeyToRawLinkPaths: Map<string, RawLinkPathAccumulator>,
	lookupKey: string,
	rawLinkPath: string,
): void {
	const existing = lookupKeyToRawLinkPaths.get(lookupKey);
	if (existing === undefined) {
		lookupKeyToRawLinkPaths.set(lookupKey, rawLinkPath);
		return;
	}

	if (typeof existing === "string") {
		if (existing === rawLinkPath) return;

		const paths = new Set<string>();
		paths.add(existing);
		paths.add(rawLinkPath);
		lookupKeyToRawLinkPaths.set(lookupKey, paths);
		return;
	}

	existing.add(rawLinkPath);
}

export function recordFileLocalReference(
	state: FileLocalAggregation,
	linkReference: LinkReference,
	resolved: ResolvedLinkInfo,
	offset: number,
	rawLinkPath: string,
): void {
	let representativeRef: OrderedBacklinkRef | undefined;
	let sharedRep: RepresentativeRef | undefined;

	const existing = state.firstRefByLookupKey.get(resolved.rawLookupKey);
	if (!existing || offset < existing.offset) {
		representativeRef = createOrderedBacklinkRef(linkReference, resolved);
		if (existing) {
			existing.ref = representativeRef;
			existing.offset = offset;
		} else {
			sharedRep = { ref: representativeRef, offset };
			state.firstRefByLookupKey.set(resolved.rawLookupKey, sharedRep);
		}
	}
	recordLookupKeyRawLinkPath(
		state.lookupKeyToRawLinkPaths,
		resolved.rawLookupKey,
		rawLinkPath,
	);
	state.hasSourceDependentLinks ||= resolved.isSourceDependent;
	if (resolved.isUnresolved) {
		state.unresolvedLookupKeys.add(resolved.rawLookupKey);
	}

	const destination = state.destinationBuckets.get(resolved.destinationPath);
	if (!destination) {
		state.destinationBuckets.set(resolved.destinationPath, {
			count: 1,
			hasResolved: !resolved.isUnresolved,
			firstRef: sharedRep ?? {
				ref:
					representativeRef ??
					createOrderedBacklinkRef(linkReference, resolved),
				offset,
			},
		});
		return;
	}

	destination.count++;
	destination.hasResolved ||= !resolved.isUnresolved;
	if (offset < destination.firstRef.offset) {
		destination.firstRef.ref =
			representativeRef ??
			createOrderedBacklinkRef(linkReference, resolved);
		destination.firstRef.offset = offset;
	}
}

export function createBacklinkBucketForSource(
	aggregate: Pick<SourceDestinationSummary, "count" | "hasResolved">,
): BacklinkBucket {
	return {
		count: aggregate.count,
		length: aggregate.count,
		hasResolved: aggregate.hasResolved,
	};
}

export function addRepresentativeRef(
	orderedReferences: OrderedBacklinkRef[],
	representative: RepresentativeRef,
): number {
	if (representative.summaryIndex !== undefined) {
		return representative.summaryIndex;
	}

	const index = orderedReferences.length;
	orderedReferences.push(representative.ref);
	representative.summaryIndex = index;
	return index;
}

export function createSourceSummaryFromAggregation(
	localAggregation: FileLocalAggregation,
): SourceSummary | undefined {
	if (
		localAggregation.destinationBuckets.size === 0 &&
		localAggregation.firstRefByLookupKey.size === 0 &&
		localAggregation.unresolvedLookupKeys.size === 0
	) {
		return undefined;
	}

	const destinations = new Map<string, SourceDestinationSummary>();
	const orderedReferences: OrderedBacklinkRef[] = [];
	for (const [
		destinationPath,
		aggregate,
	] of localAggregation.destinationBuckets) {
		destinations.set(destinationPath, {
			count: aggregate.count,
			hasResolved: aggregate.hasResolved,
			firstRefIndex: addRepresentativeRef(
				orderedReferences,
				aggregate.firstRef,
			),
		});
	}
	const firstRefIndexByLookupKey = new Map<string, number>();
	for (const [
		lookupKey,
		representative,
	] of localAggregation.firstRefByLookupKey) {
		firstRefIndexByLookupKey.set(
			lookupKey,
			addRepresentativeRef(orderedReferences, representative),
		);
	}
	const lookupKeyToRawLinkPaths = new Map<string, string | string[]>();
	for (const [
		lookupKey,
		rawLinkPaths,
	] of localAggregation.lookupKeyToRawLinkPaths) {
		if (typeof rawLinkPaths === "string") {
			lookupKeyToRawLinkPaths.set(lookupKey, rawLinkPaths);
		} else {
			lookupKeyToRawLinkPaths.set(lookupKey, Array.from(rawLinkPaths));
		}
	}

	return {
		destinations,
		orderedReferences,
		firstRefIndexByLookupKey,
		lookupKeyToRawLinkPaths,
		unresolvedLookupKeys: takeUnresolvedLookupKeys(localAggregation),
		hasSourceDependentLinks: localAggregation.hasSourceDependentLinks,
	};
}

export function* createSourceSummaryFromAggregationChunked(
	localAggregation: FileLocalAggregation,
	yieldScheduler: YieldScheduler,
	visitDestination?: SourceSummaryDestinationVisitor,
): Generator<Promise<void>, SourceSummary | undefined, void> {
	if (
		localAggregation.destinationBuckets.size === 0 &&
		localAggregation.firstRefByLookupKey.size === 0 &&
		localAggregation.unresolvedLookupKeys.size === 0
	) {
		return undefined;
	}

	const destinations = new Map<string, SourceDestinationSummary>();
	const orderedReferences: OrderedBacklinkRef[] = [];
	let operationCount = 0;

	for (const [
		destinationPath,
		aggregate,
	] of localAggregation.destinationBuckets) {
		destinations.set(destinationPath, {
			count: aggregate.count,
			hasResolved: aggregate.hasResolved,
			firstRefIndex: addRepresentativeRef(
				orderedReferences,
				aggregate.firstRef,
			),
		});
		visitDestination?.(destinationPath, aggregate);

		operationCount++;
		const pendingYield = yieldScheduler.checkpoint(
			operationCount,
			HEAVY_YIELD_CHECK_INTERVAL,
		);
		if (pendingYield) {
			yield pendingYield;
		}
	}

	const firstRefIndexByLookupKey = new Map<string, number>();
	for (const [
		lookupKey,
		representative,
	] of localAggregation.firstRefByLookupKey) {
		firstRefIndexByLookupKey.set(
			lookupKey,
			addRepresentativeRef(orderedReferences, representative),
		);

		operationCount++;
		const pendingYield = yieldScheduler.checkpoint(
			operationCount,
			HEAVY_YIELD_CHECK_INTERVAL,
		);
		if (pendingYield) {
			yield pendingYield;
		}
	}

	const lookupKeyToRawLinkPaths = new Map<string, string | string[]>();
	for (const [
		lookupKey,
		rawLinkPaths,
	] of localAggregation.lookupKeyToRawLinkPaths) {
		if (typeof rawLinkPaths === "string") {
			lookupKeyToRawLinkPaths.set(lookupKey, rawLinkPaths);
		} else {
			lookupKeyToRawLinkPaths.set(lookupKey, Array.from(rawLinkPaths));
		}

		operationCount++;
		const pendingYield = yieldScheduler.checkpoint(
			operationCount,
			HEAVY_YIELD_CHECK_INTERVAL,
		);
		if (pendingYield) {
			yield pendingYield;
		}
	}

	return {
		destinations,
		orderedReferences,
		firstRefIndexByLookupKey,
		lookupKeyToRawLinkPaths,
		unresolvedLookupKeys: takeUnresolvedLookupKeys(localAggregation),
		hasSourceDependentLinks: localAggregation.hasSourceDependentLinks,
	};
}

function takeUnresolvedLookupKeys(
	localAggregation: FileLocalAggregation,
): ReadonlySet<string> {
	if (localAggregation.unresolvedLookupKeys.size === 0) {
		return EMPTY_UNRESOLVED_LOOKUP_KEYS;
	}

	const snapshot = localAggregation.unresolvedLookupKeys;
	localAggregation.unresolvedLookupKeys = new Set<string>();
	return snapshot;
}
