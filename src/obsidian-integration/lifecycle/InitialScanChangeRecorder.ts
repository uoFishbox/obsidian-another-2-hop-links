import type { IncrementalFileChange } from "indexing/indexState";

interface InitialTouchedPath {
	structural: boolean;
	modified: boolean;
	metadataSensitiveGeneration?: number;
}

export class InitialScanChangeRecorder {
	private touched = new Map<string, InitialTouchedPath>();

	record(change: IncrementalFileChange, metadataGeneration: number): void {
		switch (change.type) {
			case "modify":
				this.touch(change.path, false, true, undefined);
				return;
			case "resolve":
				this.touch(change.path, false, false, undefined);
				return;
			case "create":
				this.touch(change.path, true, false, metadataGeneration);
				return;
			case "delete":
				this.touch(change.path, true, false, undefined);
				return;
			case "rename":
				this.touch(change.oldPath, true, false, undefined);
				this.touch(change.newPath, true, false, metadataGeneration);
				return;
		}
	}

	hasPending(): boolean {
		return this.touched.size > 0;
	}

	needsMetadataResolve(
		currentGeneration: number,
		fileExists: (path: string) => boolean,
	): boolean {
		for (const [path, entry] of this.touched) {
			if (
				entry.metadataSensitiveGeneration !== undefined &&
				entry.metadataSensitiveGeneration >= currentGeneration &&
				fileExists(path)
			) {
				return true;
			}
		}
		return false;
	}

	drainToFinalStateChanges(
		fileExists: (path: string) => boolean,
		shouldIndexPath: (path: string) => boolean,
	): IncrementalFileChange[] {
		const touched = this.touched;
		this.touched = new Map();

		const changes: IncrementalFileChange[] = [];

		for (const [path, entry] of touched) {
			if (!shouldIndexPath(path)) {
				changes.push({ type: "delete", path });
				continue;
			}

			if (!fileExists(path)) {
				changes.push({ type: "delete", path });
				continue;
			}

			changes.push({
				type: entry.structural
					? "create"
					: entry.modified
						? "modify"
						: "resolve",
				path,
			});
		}

		return changes;
	}

	private touch(
		path: string,
		structural: boolean,
		modified: boolean,
		metadataSensitiveGeneration: number | undefined,
	): void {
		const existing = this.touched.get(path);
		if (existing) {
			existing.structural ||= structural;
			existing.modified ||= modified;
			if (metadataSensitiveGeneration !== undefined) {
				existing.metadataSensitiveGeneration = metadataSensitiveGeneration;
			}
			return;
		}

		this.touched.set(path, {
			structural,
			modified,
			metadataSensitiveGeneration,
		});
	}
}
