import { createContext } from "svelte";
import type { VirtualPreviewSurface } from "card-preview/scheduling/virtualPreviewSurface";

const [getVirtualPreviewSurface, provideVirtualPreviewSurface] =
	createContext<VirtualPreviewSurface>();

export { getVirtualPreviewSurface, provideVirtualPreviewSurface };
