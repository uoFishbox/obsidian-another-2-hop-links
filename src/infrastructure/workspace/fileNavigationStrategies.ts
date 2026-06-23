import type { Pos, TFile } from "obsidian";
import { isAdvancedCanvasPosition } from "core/rules/fileRules";

export type FileNavigationState = Record<string, unknown>;

export function buildFileNavigationState(
	file: TFile,
	position?: Pos,
): FileNavigationState | undefined {
	if (!position) {
		return undefined;
	}

	if (canUseAdvancedCanvasNavigation(file, position)) {
		return buildAdvancedCanvasNavigationState(position);
	}

	return buildLineNavigationState(position);
}

function canUseAdvancedCanvasNavigation(file: TFile, position: Pos): boolean {
	return file.extension === "canvas" && isAdvancedCanvasPosition(position);
}

function buildAdvancedCanvasNavigationState(position: Pos): FileNavigationState {
	return {
		match: {
			matches: [[0, position.end.offset]],
		},
	};
}

function buildLineNavigationState(position: Pos): FileNavigationState {
	return {
		line: position.start.line,
		scroll: position.start.line,
	};
}
