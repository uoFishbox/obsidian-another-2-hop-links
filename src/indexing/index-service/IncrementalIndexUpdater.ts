import { INDEXING_YIELD_INTERVAL_MS } from "indexing/config";
import type { IMetadataCache } from "obsidian-integration/hostContracts";
import type {
	IncrementalFileChange,
	IndexMutationResult,
	MutableIndexState,
	TimeSlicingOptions,
} from "../indexState";
import {
	collectHostSourcePaths,
	getLookupKeyForEdge,
	readCurrentSourceRow,
	reconcileSourceRow,
	resolvedEdgeKey,
	unresolvedEdgeKey,
	visitSourceRowKeys,
	type EdgeKey,
	type LinkIndexMutationSink,
	type SourceEdge,
} from "../link-index/linkIndex";
import {
	createYieldScheduler,
	defaultYieldToMainThread,
	maybeYield,
	type YieldScheduler,
} from "../timeSlicing";

class IncrementalUpdateRun implements LinkIndexMutationSink {
	readonly changedFilePaths = new Set<string>();
	readonly changedLookupKeys = new Set<string>();
	readonly changedLinkSourcePaths = new Set<string>();
	readonly changedEdgeKeys = new Set<EdgeKey>();

	constructor(
		readonly state: MutableIndexState,
		readonly yieldScheduler: YieldScheduler,
	) {}

	markChangedEdge(key: EdgeKey): void {
		this.changedEdgeKeys.add(key);
		const lookupKey = getLookupKeyForEdge(key);
		if (lookupKey) this.changedLookupKeys.add(lookupKey);
	}

	markPresentationRows(
		previousRow: readonly SourceEdge[] | undefined,
		nextRow: readonly SourceEdge[] | undefined,
	): void {
		visitSourceRowKeys(previousRow, (key) => this.markChangedEdge(key));
		visitSourceRowKeys(nextRow, (key) => this.markChangedEdge(key));
	}
}

/** Reconciles the two-map link index against Obsidian's completed link graph. */
export class IncrementalIndexUpdater {
	public constructor(private readonly metadataCache: IMetadataCache) {}

	public async applyAsync(
		state: MutableIndexState,
		changes: IncrementalFileChange[],
		options: TimeSlicingOptions = {},
	): Promise<IndexMutationResult> {
		const run = new IncrementalUpdateRun(
			state,
			createYieldScheduler(
				options.yieldFn ?? defaultYieldToMainThread,
				options.yieldIntervalMs ?? INDEXING_YIELD_INTERVAL_MS,
			),
		);
		for (const change of changes) {
			if (change.type === "rename") {
				run.changedFilePaths.add(change.oldPath);
				run.changedFilePaths.add(change.newPath);
				continue;
			}
			run.changedFilePaths.add(change.path);
		}

		const requiresHostGraphReconcile = changes.some(
			(change) => change.type === "create" || change.type === "rename",
		);
		if (requiresHostGraphReconcile) {
			await this.reconcileEntireHostGraph(run, changes);
		} else {
			await this.applyLocalChanges(run, changes);
		}

		return {
			snapshot: run.state,
			changedFilePaths: run.changedFilePaths,
			changedLookupKeys: run.changedLookupKeys,
			changedLinkSourcePaths: run.changedLinkSourcePaths,
			cacheInvalidationKeys: run.changedEdgeKeys,
			linkIndexChanged: run.changedEdgeKeys.size > 0,
		};
	}

	private async reconcileEntireHostGraph(
		run: IncrementalUpdateRun,
		changes: readonly IncrementalFileChange[],
	): Promise<void> {
		const sourcePaths = collectHostSourcePaths(this.metadataCache);
		for (const sourcePath of run.state.outgoing.keys()) {
			sourcePaths.add(sourcePath);
		}
		const presentationChangedSources = collectPresentationChangedSources(changes);
		let sourceCount = 0;

		for (const sourcePath of sourcePaths) {
			this.reconcileHostSource(
				run,
				sourcePath,
				presentationChangedSources.has(sourcePath),
			);
			sourceCount++;
			const pendingYield = maybeYield(run.yieldScheduler, sourceCount, 16);
			if (pendingYield) await pendingYield;
		}
	}

	private async applyLocalChanges(
		run: IncrementalUpdateRun,
		changes: readonly IncrementalFileChange[],
	): Promise<void> {
		const deletedPaths = new Set<string>();
		const dirtySources = new Set<string>();
		const presentationChangedSources = collectPresentationChangedSources(changes);

		for (const change of changes) {
			if (change.type === "delete") {
				deletedPaths.add(change.path);
				const incoming = run.state.incoming.get(resolvedEdgeKey(change.path));
				if (incoming) {
					for (const sourcePath of incoming.keys())
						dirtySources.add(sourcePath);
				}
				this.removeSource(run, change.path);
				run.markChangedEdge(resolvedEdgeKey(change.path));
				run.markChangedEdge(unresolvedEdgeKey(change.path));
				continue;
			}
			if (change.type === "modify") dirtySources.add(change.path);
		}

		let sourceCount = 0;
		for (const sourcePath of dirtySources) {
			if (deletedPaths.has(sourcePath)) continue;
			this.reconcileHostSource(
				run,
				sourcePath,
				presentationChangedSources.has(sourcePath),
			);
			sourceCount++;
			const pendingYield = maybeYield(run.yieldScheduler, sourceCount, 16);
			if (pendingYield) await pendingYield;
		}
	}

	private removeSource(run: IncrementalUpdateRun, sourcePath: string): void {
		const previousRow = run.state.outgoing.get(sourcePath);
		if (!previousRow) return;
		reconcileSourceRow(run.state, sourcePath, [], run);
		run.changedLinkSourcePaths.add(sourcePath);
	}

	private reconcileHostSource(
		run: IncrementalUpdateRun,
		sourcePath: string,
		presentationMayHaveChanged: boolean,
	): void {
		const previousRow = run.state.outgoing.get(sourcePath);
		const nextRow = readCurrentSourceRow(this.metadataCache, sourcePath);
		const structurallyChanged = reconcileSourceRow(
			run.state,
			sourcePath,
			nextRow,
			run,
		);

		if (presentationMayHaveChanged) {
			run.markPresentationRows(previousRow, nextRow);
		}
		if (!structurallyChanged && !presentationMayHaveChanged) return;
		if ((previousRow?.length ?? 0) === 0 && nextRow.length === 0) return;
		run.changedLinkSourcePaths.add(sourcePath);
		if (structurallyChanged) run.changedFilePaths.add(sourcePath);
	}
}

function collectPresentationChangedSources(
	changes: readonly IncrementalFileChange[],
): Set<string> {
	const result = new Set<string>();
	for (const change of changes) {
		if (change.type === "modify" || change.type === "create") {
			result.add(change.path);
		} else if (change.type === "rename") {
			result.add(change.newPath);
		}
	}
	return result;
}
