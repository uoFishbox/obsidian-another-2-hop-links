export type DecorationTargetMode =
	| "rendered"
	| "codemirror"
	| "properties"
	| "bases";

export interface DecorationTargetCollectionOptions {
	mode?: DecorationTargetMode;
	targetSelectors?: string[];
}

export function collectDecorationTargets(
	linkEl: HTMLElement,
	optionsOrSelectors: DecorationTargetCollectionOptions | string[] = {},
): HTMLElement[] {
	const options = Array.isArray(optionsOrSelectors)
		? { targetSelectors: optionsOrSelectors }
		: optionsOrSelectors;
	const mode = options.mode ?? "rendered";
	const targetSelectors = options.targetSelectors ?? [];

	if (
		targetSelectors.length === 0 &&
		(mode === "rendered" || mode === "bases")
	) {
		return [linkEl];
	}

	const targets = [linkEl];

	if (targetSelectors.length > 0) {
		const descendants = linkEl.querySelectorAll<HTMLElement>(
			targetSelectors.join(", "),
		);
		for (const el of descendants) {
			addUniqueTarget(targets, el);
		}
	}

	if (mode === "codemirror") {
		collectCodeMirrorTargets(linkEl, targets);
	}

	if (mode === "properties") {
		collectPropertyTargets(linkEl, targets);
	}

	return targets;
}

function collectCodeMirrorTargets(
	linkEl: HTMLElement,
	targets: HTMLElement[],
): void {
	const cmWrapper =
		linkEl.closest<HTMLElement>(".cm-hmd-internal-link") ??
		linkEl.closest<HTMLElement>(".cm-string.cm-url");
	if (cmWrapper) {
		addUniqueTarget(targets, cmWrapper);
	}

	const aliasOwner =
		linkEl.closest<HTMLElement>(".cm-link-has-alias") ??
		cmWrapper?.closest<HTMLElement>(".cm-link-has-alias");
	if (!aliasOwner) {
		return;
	}

	addUniqueTarget(targets, aliasOwner);

	const pipe = aliasOwner.nextElementSibling;
	if (pipe instanceof HTMLElement && pipe.matches(".cm-link-alias-pipe")) {
		addUniqueTarget(targets, pipe);

		const alias = pipe.nextElementSibling;
		if (alias instanceof HTMLElement && alias.matches(".cm-link-alias")) {
			addUniqueTarget(targets, alias);
		}
	}
}

function collectPropertyTargets(
	linkEl: HTMLElement,
	targets: HTMLElement[],
): void {
	const multiSelectPill = linkEl.closest<HTMLElement>(
		".multi-select-pill.internal-link",
	);
	if (multiSelectPill) {
		addUniqueTarget(targets, multiSelectPill);
	}

	const metadataWrapper = linkEl.closest<HTMLElement>(
		".metadata-link-inner.internal-link",
	);
	if (metadataWrapper) {
		addUniqueTarget(targets, metadataWrapper);
	}
}

function addUniqueTarget(targets: HTMLElement[], target: HTMLElement): void {
	if (!targets.includes(target)) {
		targets.push(target);
	}
}
