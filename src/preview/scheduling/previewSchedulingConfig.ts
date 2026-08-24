const PREVIEW_DOM_COMMIT_RATE_MULTIPLIER = 1.25;

export const DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND = 80;

function resolvePreviewActivationsPerSecond(domCommitsPerSecond: number): number {
	const normalizedDomCommits =
		Number.isFinite(domCommitsPerSecond) && domCommitsPerSecond > 0
			? domCommitsPerSecond
			: DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND;
	return Math.max(
		1,
		Math.floor(normalizedDomCommits / PREVIEW_DOM_COMMIT_RATE_MULTIPLIER),
	);
}

export const DEFAULT_PREVIEW_ACTIVATIONS_PER_SECOND =
	resolvePreviewActivationsPerSecond(DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND);
