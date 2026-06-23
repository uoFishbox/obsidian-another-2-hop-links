import type { SectionRenderDescriptor } from "../../../sections/types";
import type { Result, VirtualListInputError } from "./virtualListValidationError";

export interface ViewPlanInput<T, G> {
	readonly sections: readonly SectionRenderDescriptor<T, G>[];
}

export interface ValidatedViewPlanInput<T, G> {
	readonly sections: readonly SectionRenderDescriptor<T, G>[];
	readonly sectionsBySectionId: ReadonlyMap<string, SectionRenderDescriptor<T, G>>;
}

export function validateViewPlanInput<T, G>(
	input: ViewPlanInput<T, G>,
): Result<ValidatedViewPlanInput<T, G>, VirtualListInputError<T, G>> {
	const sectionsBySectionId = new Map<string, SectionRenderDescriptor<T, G>>();
	const firstBySectionId = new Map<
		string,
		{ index: number; section: SectionRenderDescriptor<T, G> }
	>();

	for (let index = 0; index < input.sections.length; index += 1) {
		const section = input.sections[index];
		const previous = firstBySectionId.get(section.sectionId);
		if (previous) {
			return {
				ok: false,
				error: {
					type: "duplicate-section-id",
					sectionId: section.sectionId,
					firstIndex: previous.index,
					secondIndex: index,
					firstSection: previous.section,
					secondSection: section,
				},
			};
		}

		firstBySectionId.set(section.sectionId, { index, section });
		sectionsBySectionId.set(section.sectionId, section);
	}

	return {
		ok: true,
		value: {
			sections: input.sections,
			sectionsBySectionId,
		},
	};
}
