import type { CardPreviewRequest } from "features/card-preview/core/cardPreviewRequest";
import { vi } from "vitest";

export interface TestPreviewBinding {
	readonly slotId: string;
	readonly rowIndex: number;
	readonly ownerKey: string;
	readonly request: CardPreviewRequest;
}

export interface PreviewFrame {
	readonly previewBindingsBySlot: ReadonlyMap<string, TestPreviewBinding>;
	readonly previewWindow: {
		readonly previewRange: { readonly start: number; readonly end: number };
		readonly active: boolean;
	};
}

/** Records imperative preview-surface publications as immutable test snapshots. */
export function createPreviewSurfaceProbe(
	registerHost = vi.fn(() => ({ dispose: vi.fn() })),
) {
	const publish = vi.fn<(frame: PreviewFrame) => void>();
	let bindings = new Map<string, TestPreviewBinding>();
	let stagedBindings: Map<string, TestPreviewBinding> | undefined;
	let bindingsChanged = false;
	let initialized = false;
	let rangeStart = 0;
	let rangeEnd = 0;
	let active = false;

	const surface = {
		registerHost,
		beginBindings: vi.fn(() => {
			stagedBindings = new Map();
		}),
		bindSlot: vi.fn(
			(
				slotId: string,
				rowIndex: number,
				ownerKey: string,
				request: CardPreviewRequest,
			): void => {
				if (!stagedBindings) return;
				const previous = bindings.get(slotId);
				const binding =
					previous?.rowIndex === rowIndex &&
					previous.ownerKey === ownerKey &&
					previous.request.renderKey === request.renderKey
						? previous
						: { slotId, rowIndex, ownerKey, request };
				stagedBindings.set(slotId, binding);
			},
		),
		endBindings: vi.fn(() => {
			if (!stagedBindings) return;
			const sameBindings =
				stagedBindings.size === bindings.size &&
				[...stagedBindings].every(
					([slotId, binding]) => bindings.get(slotId) === binding,
				);
			if (!sameBindings) {
				bindings = stagedBindings;
				bindingsChanged = true;
			}
			stagedBindings = undefined;
		}),
		setActiveRange: vi.fn(
			(start: number, end: number, nextActive: boolean): void => {
				const rangeChanged =
					!initialized ||
					rangeStart !== start ||
					rangeEnd !== end ||
					active !== nextActive;
				rangeStart = start;
				rangeEnd = end;
				active = nextActive;
				initialized = true;
				if (!rangeChanged && !bindingsChanged) return;
				bindingsChanged = false;
				publish({
					previewBindingsBySlot: bindings,
					previewWindow: {
						previewRange: { start, end },
						active: nextActive,
					},
				});
			},
		),
		dispose: vi.fn(),
	};

	return { publish, surface };
}
