import type { DeskState } from "types/settings";

export type {
	DeskCardRecord,
	DeskGridPosition,
	DeskState,
} from "types/settings";

export const DEFAULT_DESK_STATE: DeskState = {
	version: 1,
	cards: [],
};
