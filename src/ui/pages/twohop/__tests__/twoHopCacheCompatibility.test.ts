import { describe, expect, it } from "vitest";
import { createTwoHopDataIdentityCache } from "../twoHopDataIdentityCache";
import { createTwoHopSectionDescriptorIdentityCache } from "../twoHopSectionDescriptorIdentityCache";
import { createTwoHopRowModelCache } from "../twoHopRowModelCache";
import { createTwoHopCompiledPlanCache } from "../twoHopCompiledPlanCache";
import { createTwoHopInteractionResolverProvider } from "../twoHopInteractionResolverCache";
import { createTwoHopInteractionDescriptorCache } from "../twoHopInteractionDescriptorCache";

describe("two-hop cache compatibility exports", () => {
	it("keeps legacy factories as aliases of the explicit cache boundaries", () => {
		expect(createTwoHopSectionDescriptorIdentityCache).toBe(
			createTwoHopDataIdentityCache,
		);
		expect(createTwoHopCompiledPlanCache).toBe(createTwoHopRowModelCache);
		expect(createTwoHopInteractionDescriptorCache).toBe(
			createTwoHopInteractionResolverProvider,
		);
	});
});
