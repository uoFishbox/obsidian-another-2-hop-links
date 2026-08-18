import type { CardPreviewRequest } from "features/card-preview/core/cardPreviewRequest";
import { vi } from "vitest";

export interface TestPreviewBinding {
	readonly slotId: string;
	readonly rowIndex: number;
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
	let bindingsChanged = false;
	let initialized = false;
	let rangeStart = 0;
	let rangeEnd = 0;
	let active = false;

	const surface = {
		registerHost,
		commit: vi.fn(
			(frame: {
				readonly active: boolean;
				readonly activeRange: { readonly start: number; readonly end: number };
				readonly bindings: readonly TestPreviewBinding[];
			}): void => {
				surface.syncBindings(
					frame.bindings.map((binding) => ({
						key: binding.slotId,
						rowIndex: binding.rowIndex,
						request: binding.request,
					})),
				);
				surface.setActiveRange(
					frame.activeRange.start,
					frame.activeRange.end,
					frame.active,
				);
			},
		),
		syncBindings: vi.fn(
			(
				next: readonly {
					readonly key: string;
					readonly rowIndex: number;
					readonly request: CardPreviewRequest;
				}[],
			): void => {
				const nextBindings = new Map<string, TestPreviewBinding>();
				for (const binding of next) {
					const previous = bindings.get(binding.key);
					const value =
						previous?.rowIndex === binding.rowIndex &&
						previous.request.renderKey === binding.request.renderKey
							? previous
							: {
									slotId: binding.key,
									rowIndex: binding.rowIndex,
									request: binding.request,
								};
					nextBindings.set(binding.key, value);
				}
				const sameBindings =
					nextBindings.size === bindings.size &&
					[...nextBindings].every(
						([key, binding]) => bindings.get(key) === binding,
					);
				if (!sameBindings) {
					bindings = nextBindings;
					bindingsChanged = true;
				}
			},
		),
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
