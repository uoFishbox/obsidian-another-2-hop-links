/**
 * Compatibility boundary for the pre-slot-store API.
 *
 * New code should use `createTwoHopPhysicalSlotStore`; standalone pool access
 * remains for focused controller and Svelte identity tests.
 */
export {
	createTwoHopFixedRowSlotPool,
	type TwoHopFixedCellSlotController,
	type TwoHopFixedRowSlotController,
	type TwoHopFixedRowSlotPool,
} from "./twoHopPhysicalSlotStore.svelte";
