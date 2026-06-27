import type { SectionRenderDescriptor } from "../../../sections/types";
import type { VirtualListLogicalCell } from "../logicalCell";
import type {
	RenderBodyKey,
	RenderRevision,
	RenderRevisionFallbackPolicy,
} from "../renderRevision";
import {
	formatVirtualListInputError,
	type Result,
	type VirtualListInputError,
} from "../validation/virtualListValidationError";

type HeaderLogicalCell<T> = Extract<VirtualListLogicalCell<T>, { kind: "header" }>;
type ItemLogicalCell<T> = Extract<VirtualListLogicalCell<T>, { kind: "item" }>;

export interface MountedRenderBodyIdentity {
	readonly renderBodyKind: "item" | "header" | "load-more";
	readonly renderBodySectionId: string;
	readonly renderBodySourceKey?: string;
	readonly renderBodyCellKey?: string;
	readonly renderBodyRevision?: RenderRevision;
}

export type ResolvedItemRenderRevisionToken = {
	readonly kind: "render";
	readonly revision: RenderRevision;
};
export type ResolvedHeaderRenderRevisionToken = {
	readonly kind: "render";
	readonly revision: RenderRevision;
};

const DEFAULT_RENDER_REVISION_FALLBACK_POLICY: RenderRevisionFallbackPolicy =
	"source-key-only";

const escapeRenderRevisionString = (value: string): string =>
	value.replace(/\\/g, "\\\\").replace(/\|/g, "\\p");

export function encodeRenderRevisionToken(value: RenderRevision): string {
	if (value === null) {
		return "null";
	}
	if (typeof value === "boolean") {
		return `b:${value}`;
	}
	if (typeof value === "string") {
		return `s:${escapeRenderRevisionString(value)}`;
	}
	if (typeof value === "number") {
		if (Number.isNaN(value)) {
			return "n:NaN";
		}
		if (Object.is(value, -0)) {
			return "n:-0";
		}
		return `n:${value}`;
	}

	const exhaustive: never = value;
	return exhaustive;
}

export function encodeResolvedItemRenderRevisionToken(
	token: ResolvedItemRenderRevisionToken,
): string {
	return encodeRenderRevisionToken(token.revision);
}

function encodeResolvedHeaderRenderRevisionToken(
	token: ResolvedHeaderRenderRevisionToken,
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
): Result<ResolvedItemRenderRevisionToken, VirtualListInputError<T, unknown>> {
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

export function resolveHeaderRenderRevisionToken<T, G>(
	descriptor: SectionRenderDescriptor<T, G>,
): ResolvedHeaderRenderRevisionToken {
	if (descriptor.headerRenderRevision !== undefined) {
		return {
			kind: "render",
			revision: descriptor.headerRenderRevision,
		};
	}

	return {
		kind: "render",
		revision: null,
	};
}

function createViewPlanHeaderRenderBodyKey<T, G>(
	cell: HeaderLogicalCell<T>,
	descriptor: SectionRenderDescriptor<T, G>,
): RenderBodyKey {
	return (
		"header|" +
		encodeRenderRevisionToken(String(cell.key)) +
		"|" +
		encodeRenderRevisionToken(descriptor.sectionId) +
		"|" +
		encodeResolvedHeaderRenderRevisionToken(
			resolveHeaderRenderRevisionToken(descriptor),
		)
	);
}

function createViewPlanRenderBodyKey<T, G>(
	cell: VirtualListLogicalCell<T>,
	descriptor: SectionRenderDescriptor<T, G>,
	fallbackPolicy?: RenderRevisionFallbackPolicy,
): RenderBodyKey {
	switch (cell.kind) {
		case "header":
			return createViewPlanHeaderRenderBodyKey(cell, descriptor);
		case "item":
			return (
				"item|" +
				encodeRenderRevisionToken(descriptor.sectionId) +
				"|" +
				encodeRenderRevisionToken(String(cell.sourceKey ?? cell.key)) +
				"|" +
				encodeResolvedItemRenderRevisionToken(
					resolveItemRenderRevisionToken(cell, fallbackPolicy),
				)
			);
		case "load-more":
			return (
				"load-more|" +
				encodeRenderRevisionToken(String(cell.key)) +
				"|" +
				encodeRenderRevisionToken(descriptor.sectionId)
			);
	}
}

export function getViewPlanRenderBodyIdentityFields<T, G>(
	cell: VirtualListLogicalCell<T>,
	descriptor: SectionRenderDescriptor<T, G>,
	fallbackPolicy?: RenderRevisionFallbackPolicy,
): MountedRenderBodyIdentity {
	switch (cell.kind) {
		case "item":
			return {
				renderBodyKind: "item",
				renderBodySectionId: descriptor.sectionId,
				renderBodySourceKey: String(cell.sourceKey ?? cell.key),
				renderBodyRevision: resolveItemRenderRevisionToken(cell, fallbackPolicy)
					.revision,
			};
		case "header":
			return {
				renderBodyKind: "header",
				renderBodySectionId: descriptor.sectionId,
				renderBodyCellKey: String(cell.key),
				renderBodyRevision:
					resolveHeaderRenderRevisionToken(descriptor).revision,
			};
		case "load-more":
			return {
				renderBodyKind: "load-more",
				renderBodySectionId: descriptor.sectionId,
				renderBodyCellKey: String(cell.key),
			};
	}
}

function canReuseViewPlanRenderBodyKey<T, G>(
	previous: Partial<MountedRenderBodyIdentity> | undefined,
	cell: VirtualListLogicalCell<T>,
	descriptor: SectionRenderDescriptor<T, G>,
	fallbackPolicy?: RenderRevisionFallbackPolicy,
): boolean {
	if (!previous) {
		return false;
	}

	switch (cell.kind) {
		case "item": {
			const sourceKey = String(cell.sourceKey ?? cell.key);
			const revision = resolveItemRenderRevisionToken(
				cell,
				fallbackPolicy,
			).revision;

			return (
				previous.renderBodyKind === "item" &&
				previous.renderBodySectionId === descriptor.sectionId &&
				previous.renderBodySourceKey === sourceKey &&
				Object.is(previous.renderBodyRevision, revision)
			);
		}
		case "header": {
			const revision = resolveHeaderRenderRevisionToken(descriptor).revision;

			return (
				previous.renderBodyKind === "header" &&
				previous.renderBodySectionId === descriptor.sectionId &&
				previous.renderBodyCellKey === String(cell.key) &&
				Object.is(previous.renderBodyRevision, revision)
			);
		}
		case "load-more":
			return (
				previous.renderBodyKind === "load-more" &&
				previous.renderBodySectionId === descriptor.sectionId &&
				previous.renderBodyCellKey === String(cell.key)
			);
	}
}

export function resolveStableViewPlanRenderBodyKey<T, G>(params: {
	previous:
		| ({
				readonly renderBodyKey?: RenderBodyKey;
		  } & Partial<MountedRenderBodyIdentity>)
		| undefined;
	previousCells?:
		| readonly ({
				readonly renderBodyKey?: RenderBodyKey;
		  } & Partial<MountedRenderBodyIdentity>)[]
		| undefined;
	cell: VirtualListLogicalCell<T>;
	descriptor: SectionRenderDescriptor<T, G>;
	fallbackPolicy?: RenderRevisionFallbackPolicy;
}): RenderBodyKey {
	const previousRenderBodyKey = params.previous?.renderBodyKey;
	if (
		previousRenderBodyKey !== undefined &&
		canReuseViewPlanRenderBodyKey(
			params.previous,
			params.cell,
			params.descriptor,
			params.fallbackPolicy,
		)
	) {
		return previousRenderBodyKey;
	}

	if (params.previousCells) {
		for (const previousCell of params.previousCells) {
			const previousCellRenderBodyKey = previousCell.renderBodyKey;
			if (
				previousCellRenderBodyKey !== undefined &&
				canReuseViewPlanRenderBodyKey(
					previousCell,
					params.cell,
					params.descriptor,
					params.fallbackPolicy,
				)
			) {
				return previousCellRenderBodyKey;
			}
		}
	}

	return createViewPlanRenderBodyKey(
		params.cell,
		params.descriptor,
		params.fallbackPolicy,
	);
}

export function hasSameReusableCellKey(previous: unknown, next: unknown): boolean {
	if (Object.is(previous, next)) {
		return true;
	}

	if (!Array.isArray(previous) || !Array.isArray(next)) {
		return false;
	}

	if (previous.length !== next.length) {
		return false;
	}

	for (let index = 0; index < previous.length; index += 1) {
		if (!Object.is(previous[index], next[index])) {
			return false;
		}
	}

	return true;
}
