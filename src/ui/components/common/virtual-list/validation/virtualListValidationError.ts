import type { SectionRenderDescriptor } from "../../../sections/types";

export type Result<T, E> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: E };

export type VirtualListInputError<T = unknown, G = unknown> =
	| {
			readonly type: "duplicate-section-id";
			readonly sectionId: string;
			readonly firstIndex: number;
			readonly secondIndex: number;
			readonly firstSection: SectionRenderDescriptor<T, G>;
			readonly secondSection: SectionRenderDescriptor<T, G>;
	  }
	| {
			readonly type: "missing-array-source-key-resolver";
	  }
	| {
			readonly type: "missing-item-render-revision";
			readonly sourceKey: string;
			readonly cellKey: string;
	  };

export function formatVirtualListInputError<T, G>(
	error: VirtualListInputError<T, G>,
): string {
	switch (error.type) {
		case "duplicate-section-id":
			return (
				`ViewPlan: duplicate sectionId ${JSON.stringify(
					error.sectionId,
				)}. ` +
				`first index=${error.firstIndex}, first sectionKey=${JSON.stringify(
					error.firstSection.sectionKey,
				)}; ` +
				`second index=${error.secondIndex}, second sectionKey=${JSON.stringify(
					error.secondSection.sectionKey,
				)}.`
			);
		case "missing-array-source-key-resolver":
			return "getKey is required for array-backed sources.";
		case "missing-item-render-revision":
			return `Missing item render revision for sourceKey=${JSON.stringify(
				error.sourceKey,
			)} cellKey=${JSON.stringify(error.cellKey)}.`;
	}
}
