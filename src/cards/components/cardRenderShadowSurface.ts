import {
	registerMathJaxShadowRoot,
	unregisterMathJaxShadowRoot,
} from "shared/ui/dom/mathJaxShadowStyles";
import { CARD_RENDER_SHADOW_CSS } from "./cardRenderShadowStyles";

const SHADOW_BASE_STYLE_ATTRIBUTE = "data-ccl-card-render-shadow-base-style";
const SHADOW_SURFACE_ATTRIBUTE = "data-ccl-card-render-shadow-surface";

function resolveSectionContextClassName(host: HTMLElement): string {
	const classNames = new Set<string>();

	for (const className of Array.from(host.classList)) {
		classNames.add(className);
	}

	const sectionHost = host.closest<HTMLElement>(".cosense-card-links__section");
	if (sectionHost) {
		for (const className of Array.from(sectionHost.classList)) {
			classNames.add(className);
		}
	}

	return Array.from(classNames).join(" ");
}

function syncSurfaceClassName(host: HTMLElement, surfaceEl: HTMLDivElement): void {
	const nextClassName = resolveSectionContextClassName(host);
	if (surfaceEl.className !== nextClassName) {
		surfaceEl.className = nextClassName;
	}
}

export interface CardRenderShadowSurfaceHandles {
	shadowRoot: ShadowRoot;
	surfaceEl: HTMLDivElement;
	dispose: () => void;
}

export function ensureCardRenderShadowSurface(
	host: HTMLElement,
): CardRenderShadowSurfaceHandles {
	if (typeof host.attachShadow !== "function") {
		throw new Error("Card render host does not support attachShadow().");
	}

	const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: "open" });
	registerMathJaxShadowRoot(shadowRoot);
	const ownerDocument = host.ownerDocument;

	let baseStyleEl = shadowRoot.querySelector<HTMLStyleElement>(
		`style[${SHADOW_BASE_STYLE_ATTRIBUTE}]`,
	);
	if (!baseStyleEl) {
		baseStyleEl = ownerDocument.createElement("style");
		baseStyleEl.setAttribute(SHADOW_BASE_STYLE_ATTRIBUTE, "1");
		shadowRoot.prepend(baseStyleEl);
	}
	if (baseStyleEl.textContent !== CARD_RENDER_SHADOW_CSS) {
		baseStyleEl.textContent = CARD_RENDER_SHADOW_CSS;
	}

	let surfaceEl = shadowRoot.querySelector<HTMLDivElement>(
		`div[${SHADOW_SURFACE_ATTRIBUTE}]`,
	);
	if (!surfaceEl) {
		surfaceEl = ownerDocument.createElement("div");
		surfaceEl.setAttribute(SHADOW_SURFACE_ATTRIBUTE, "1");
		shadowRoot.append(surfaceEl);
	}

	syncSurfaceClassName(host, surfaceEl);

	let disposed = false;

	return {
		shadowRoot,
		surfaceEl,
		dispose: () => {
			if (disposed) {
				return;
			}
			disposed = true;
			unregisterMathJaxShadowRoot(shadowRoot);
		},
	};
}
