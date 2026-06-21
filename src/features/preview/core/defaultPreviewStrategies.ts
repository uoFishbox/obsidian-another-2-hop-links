import type { PreviewStrategy } from "./PreviewStrategy";
import { createCanvasPreviewStrategy } from "../strategies/CanvasStrategy";
import { createCustomBlockStrategy } from "../strategies/PriorityBlockStrategy";
import { createEmbeddedMediaStrategy } from "../strategies/EmbeddedMediaStrategy";
import { createFrontmatterImageStrategy } from "../strategies/FrontmatterImageStrategy";
import { createFrontmatterPropertyStrategy } from "../strategies/FrontmatterPropertyStrategy";
import { createImagePreviewStrategy } from "../strategies/ImageStrategy";
import { createTextSnippetStrategy } from "../strategies/TextSnippetStrategy";
import { createVideoPreviewStrategy } from "../strategies/VideoStrategy";

export function createDefaultPreviewStrategies(): PreviewStrategy[] {
	return [
		createFrontmatterPropertyStrategy(),
		createCustomBlockStrategy(),
		createImagePreviewStrategy(),
		createVideoPreviewStrategy(),
		createCanvasPreviewStrategy(),
		createFrontmatterImageStrategy(),
		createEmbeddedMediaStrategy(),
		createTextSnippetStrategy(),
	];
}
