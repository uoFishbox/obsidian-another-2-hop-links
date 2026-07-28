import { vi } from "vitest";
import { setDebugDisableRenderedPreviewCache } from "appConstants";

setDebugDisableRenderedPreviewCache(false);

if (typeof URL.createObjectURL !== "function") {
	URL.createObjectURL = vi.fn(() => "blob:mock-url");
}

if (typeof URL.revokeObjectURL !== "function") {
	URL.revokeObjectURL = vi.fn();
}
