import type { VirtualListLogicalCell } from "../../logicalCell";
import type {
	RenderRevision,
	RenderRevisionFallbackPolicy,
} from "../../renderRevision";
import {
	formatVirtualListInputError,
	type Result,
	type VirtualListInputError,
} from "../../validation/virtualListValidationError";

type ItemLogicalCell<T> = Extract<VirtualListLogicalCell<T>, { kind: "item" }>;

export type ResolvedItemRenderRevisionToken = {
	readonly kind: "render";
	readonly revision: RenderRevision;
};

const DEFAULT_RENDER_REVISION_FALLBACK_POLICY: RenderRevisionFallbackPolicy =
	"source-key-only";

const escapeRenderRevisionString = (value: string): string => {
	if (!value.includes("\\") && !value.includes("|")) {
		return value;
	}

	return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\p");
};

export function encodeRenderRevisionToken(value: RenderRevision): string {
	if (value === null) return "null";
	if (typeof value === "boolean") return `b:${value}`;
	if (typeof value === "string") return `s:${escapeRenderRevisionString(value)}`;
	if (Number.isNaN(value)) return "n:NaN";
	if (Object.is(value, -0)) return "n:-0";
	return `n:${value}`;
}

export function encodeResolvedItemRenderRevisionToken(
	token: ResolvedItemRenderRevisionToken,
): string {
	return encodeRenderRevisionToken(token.revision);
}

export function resolveItemRenderRevisionToken<T>(
	cell: ItemLogicalCell<T>,
	fallbackPolicy: RenderRevisionFallbackPolicy = DEFAULT_RENDER_REVISION_FALLBACK_POLICY,
): ResolvedItemRenderRevisionToken {
	const result = tryResolveItemRenderRevisionToken(cell, fallbackPolicy);
	if (!result.ok) {
		throw new Error(formatVirtualListInputError(result.error));
	}

	return result.value;
}

export function tryResolveItemRenderRevisionToken<T>(
	cell: ItemLogicalCell<T>,
	fallbackPolicy: RenderRevisionFallbackPolicy = DEFAULT_RENDER_REVISION_FALLBACK_POLICY,
): Result<ResolvedItemRenderRevisionToken, VirtualListInputError> {
	if (cell.itemRenderRevision !== undefined) {
		return {
			ok: true,
			value: {
				kind: "render",
				revision: cell.itemRenderRevision,
			},
		};
	}

	switch (fallbackPolicy) {
		case "source-key-only":
			return {
				ok: true,
				value: {
					kind: "render",
					revision: null,
				},
			};
		case "required":
			return {
				ok: false,
				error: {
					type: "missing-item-render-revision",
					sourceKey: String(cell.sourceKey ?? cell.key),
					cellKey: String(cell.key),
				},
			};
	}
}
