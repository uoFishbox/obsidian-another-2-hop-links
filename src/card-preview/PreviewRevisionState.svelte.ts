export type PreviewInvalidation = "all" | ReadonlySet<string> | undefined;

/** Read-only preview revision capabilities consumed by card renderers. */
export interface PreviewRevisionReader {
	readonly globalVersion: number;
	readonly pathVersions: Readonly<Record<string, number>>;
	getRenderVersion(path: string): string;
}

/** Tracks render revisions for cached card previews. */
export class PreviewRevisionState implements PreviewRevisionReader {
	declare globalVersion: number;
	declare pathVersions: Record<string, number>;

	constructor() {
		this.globalVersion = $state(0);
		this.pathVersions = $state.raw<Record<string, number>>({});
	}

	getRenderVersion(path: string): string {
		return `${this.globalVersion}:${this.pathVersions[path] ?? 0}`;
	}

	invalidate(invalidation: PreviewInvalidation): void {
		if (!invalidation) return;

		if (invalidation === "all") {
			this.globalVersion += 1;
			return;
		}

		const nextPathVersions = { ...this.pathVersions };
		for (const path of invalidation) {
			nextPathVersions[path] = (nextPathVersions[path] ?? 0) + 1;
		}
		this.pathVersions = nextPathVersions;
	}

	reset(): void {
		this.globalVersion = 0;
		this.pathVersions = {};
	}
}
