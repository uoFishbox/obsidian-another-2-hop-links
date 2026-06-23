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

function isStyleElement(value: unknown): value is HTMLStyleElement {
	return value instanceof HTMLStyleElement;
}

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

function getMathJaxStylesheetSource(): HTMLStyleElement | null {
	const documentStylesheet = document.getElementById(DOCUMENT_MATHJAX_STYLE_ID);
	return isStyleElement(documentStylesheet) ? documentStylesheet : null;
}

function cloneMathJaxStylesheet(
	source: HTMLStyleElement,
	cssText: string,
): HTMLStyleElement {
	const cloned = document.createElement("style");
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
	shadowRoot.prepend(cloneMathJaxStylesheet(source, nextText));
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

export function syncRegisteredMathJaxShadowRoots(): boolean {
	pruneDisconnectedShadowRoots();

	const source = getMathJaxStylesheetSource();
	if (!source) {
		return false;
	}

	let didSync = false;
	for (const shadowRoot of registeredShadowRoots) {
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

		if (typeof window !== "undefined" && window.requestAnimationFrame) {
			window.requestAnimationFrame(() => flush());
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

	const source = getMathJaxStylesheetSource();
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
	if (!(root instanceof ShadowRoot)) {
		return false;
	}

	if (!registeredShadowRoots.has(root)) {
		return false;
	}

	return syncMathJaxStylesToShadowRoot(root);
}
