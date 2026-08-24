import {
	getOptionalOwnerWindow,
	isHtmlStyleElementLike,
	isShadowRootLike,
} from "./realmSafeDom";

const MATHJAX_SHADOW_STYLE_ATTRIBUTE = "data-ccl-mathjax-shadow-style";
const DOCUMENT_MATHJAX_STYLE_ID = "MJX-CHTML-styles";
const SUSPICIOUS_CSS_SHRINK_RATIO = 0.7;

const registeredShadowRoots = new Set<ShadowRoot>();
let lastGoodMathJaxCssText = "";
let isMathJaxShadowSyncQueued = false;
let hasInstalledMathJaxShadowPatch = false;

type MathJaxWithStylesheet = {
	startup?: {
		adaptor?: {
			cssText?: (stylesheet: unknown) => string;
		};
		document?: {
			updateDocument?: (...args: unknown[]) => unknown;
		};
	};
};

function getMathJax(): MathJaxWithStylesheet | undefined {
	return (globalThis as { MathJax?: MathJaxWithStylesheet }).MathJax;
}

function getMathJaxStylesheetText(source: HTMLStyleElement): string {
	const adaptorCssText = getMathJax()?.startup?.adaptor?.cssText;
	if (typeof adaptorCssText === "function") {
		try {
			const cssText = adaptorCssText(source);
			if (typeof cssText === "string") {
				return cssText;
			}
		} catch {
			// Fall through to CSSOM/textContent serialization below.
		}
	}

	const stylesheet = source.sheet;
	if (stylesheet) {
		try {
			return Array.from(stylesheet.cssRules)
				.map((rule) => rule.cssText)
				.join("\n");
		} catch {
			// Accessing cssRules can throw for some stylesheet implementations.
		}
	}

	return source.textContent ?? "";
}

function getMathJaxStylesheetSource(
	ownerDocument?: Document | null,
): HTMLStyleElement | null {
	const documents: Document[] = [];
	if (ownerDocument) documents.push(ownerDocument);
	if (typeof document !== "undefined" && document !== ownerDocument) {
		documents.push(document);
	}

	for (const candidateDocument of documents) {
		const stylesheet = candidateDocument.getElementById(DOCUMENT_MATHJAX_STYLE_ID);
		if (isHtmlStyleElementLike(stylesheet)) return stylesheet;
	}
	return null;
}

function cloneMathJaxStylesheet(
	source: HTMLStyleElement,
	cssText: string,
	targetDocument: Document,
): HTMLStyleElement {
	const cloned = targetDocument.createElement("style");
	cloned.setAttribute(MATHJAX_SHADOW_STYLE_ATTRIBUTE, "1");
	cloned.textContent = cssText;

	if (source.media) {
		cloned.media = source.media;
	}

	const nonce = source.getAttribute("nonce");
	if (nonce) {
		cloned.setAttribute("nonce", nonce);
	}

	return cloned;
}

function isAcceptableMathJaxCssText(nextText: string): boolean {
	const trimmedText = nextText.trim();
	if (!trimmedText) {
		return false;
	}

	if (!lastGoodMathJaxCssText) {
		return true;
	}

	return (
		trimmedText.length >=
		Math.floor(lastGoodMathJaxCssText.length * SUSPICIOUS_CSS_SHRINK_RATIO)
	);
}

function resolveStableMathJaxCssText(
	source: HTMLStyleElement,
	existingText?: string,
): string {
	const nextText = getMathJaxStylesheetText(source);
	if (isAcceptableMathJaxCssText(nextText)) {
		lastGoodMathJaxCssText = nextText;
		return nextText;
	}

	return existingText ?? lastGoodMathJaxCssText;
}

function syncMathJaxStylesToShadowRootWithSource(
	shadowRoot: ShadowRoot,
	source: HTMLStyleElement,
): boolean {
	const existing = shadowRoot.querySelector<HTMLStyleElement>(
		`style[${MATHJAX_SHADOW_STYLE_ATTRIBUTE}]`,
	);
	const nextText = resolveStableMathJaxCssText(
		source,
		existing?.textContent ?? undefined,
	);
	if (!nextText) {
		return false;
	}

	if (existing?.textContent === nextText) {
		return true;
	}

	existing?.remove();
	shadowRoot.prepend(
		cloneMathJaxStylesheet(source, nextText, shadowRoot.ownerDocument),
	);
	return true;
}

function pruneDisconnectedShadowRoots(): void {
	for (const shadowRoot of Array.from(registeredShadowRoots)) {
		if (!shadowRoot.host?.isConnected) {
			registeredShadowRoots.delete(shadowRoot);
		}
	}
}

export function resetMathJaxShadowStylesStateForTests(): void {
	registeredShadowRoots.clear();
	lastGoodMathJaxCssText = "";
	isMathJaxShadowSyncQueued = false;
	hasInstalledMathJaxShadowPatch = false;
}

export function registerMathJaxShadowRoot(shadowRoot: ShadowRoot): void {
	registeredShadowRoots.add(shadowRoot);
	queueMathJaxShadowStylesSync();
}

export function unregisterMathJaxShadowRoot(shadowRoot: ShadowRoot): void {
	registeredShadowRoots.delete(shadowRoot);
}

function syncRegisteredMathJaxShadowRoots(): boolean {
	pruneDisconnectedShadowRoots();

	let didSync = false;
	for (const shadowRoot of registeredShadowRoots) {
		const source = getMathJaxStylesheetSource(shadowRoot.ownerDocument);
		if (!source) continue;
		didSync =
			syncMathJaxStylesToShadowRootWithSource(shadowRoot, source) || didSync;
	}

	return didSync;
}

export function queueMathJaxShadowStylesSync(): void {
	if (isMathJaxShadowSyncQueued) {
		return;
	}

	isMathJaxShadowSyncQueued = true;
	queueMicrotask(() => {
		const flush = () => {
			isMathJaxShadowSyncQueued = false;
			syncRegisteredMathJaxShadowRoots();
		};

		const ownerWindows = new Set<Window>();
		for (const shadowRoot of registeredShadowRoots) {
			const ownerWindow = getOptionalOwnerWindow(shadowRoot.host);
			if (ownerWindow) ownerWindows.add(ownerWindow);
		}
		if (ownerWindows.size > 0) {
			for (const ownerWindow of ownerWindows) {
				if (typeof ownerWindow.requestAnimationFrame === "function") {
					ownerWindow.requestAnimationFrame(() => {
						if (isMathJaxShadowSyncQueued) flush();
					});
				} else {
					ownerWindow.setTimeout(() => {
						if (isMathJaxShadowSyncQueued) flush();
					}, 0);
				}
			}
			return;
		}

		globalThis.setTimeout(() => flush(), 0);
	});
}

export function installMathJaxShadowPatch(): void {
	if (hasInstalledMathJaxShadowPatch) {
		return;
	}

	const mathJaxDocument = getMathJax()?.startup?.document;
	const updateDocument = mathJaxDocument?.updateDocument;
	if (!mathJaxDocument || typeof updateDocument !== "function") {
		return;
	}

	mathJaxDocument.updateDocument = function patchedUpdateDocument(
		this: unknown,
		...args: unknown[]
	) {
		const result = updateDocument.apply(this, args);

		if (
			typeof result === "object" &&
			result !== null &&
			"then" in result &&
			typeof (result as PromiseLike<unknown>).then === "function"
		) {
			void Promise.resolve(result).finally(() => {
				queueMathJaxShadowStylesSync();
			});
		} else {
			queueMathJaxShadowStylesSync();
		}

		return result;
	};

	hasInstalledMathJaxShadowPatch = true;
	queueMathJaxShadowStylesSync();
}

export function syncMathJaxStylesToShadowRoot(shadowRoot: ShadowRoot): boolean {
	registerMathJaxShadowRoot(shadowRoot);

	const source = getMathJaxStylesheetSource(shadowRoot.ownerDocument);
	if (!source) {
		return false;
	}

	return syncMathJaxStylesToShadowRootWithSource(shadowRoot, source);
}

export function syncMathJaxStylesForNode(node: Node | null | undefined): boolean {
	if (!node) {
		return false;
	}

	const root = node.getRootNode();
	if (!isShadowRootLike(root)) {
		return false;
	}

	if (!registeredShadowRoots.has(root)) {
		return false;
	}

	return syncMathJaxStylesToShadowRoot(root);
}
