import type { TFile } from "obsidian";
import type { PreviewData } from "../types";

// Simple queue to limit concurrent generations (prevents browser decoder exhaustion)
const MAX_CONCURRENT_GENERATIONS = 3;
const IDLE_GENERATION_TIMEOUT_MS = 150;
let activeGenerations = 0;
interface VideoThumbnailResult {
	url: string;
	byteSize: number;
}

interface GenerationQueueTask {
	cancelled: boolean;
	started: boolean;
	ownerWindow: Window;
	cancelSchedule: (() => void) | undefined;
	cleanup: () => void;
	reject: (error: unknown) => void;
	resolve: (value: unknown) => void;
	run: () => Promise<void>;
}
const generationQueue: GenerationQueueTask[] = [];
const scheduledGenerationTasks = new Set<GenerationQueueTask>();

function processQueue(): void {
	while (
		activeGenerations + scheduledGenerationTasks.size <
			MAX_CONCURRENT_GENERATIONS &&
		generationQueue.length > 0
	) {
		const nextTask = generationQueue.shift();
		if (!nextTask) return;
		scheduledGenerationTasks.add(nextTask);

		let ranSynchronously = false;
		const cancelSchedule = scheduleGeneration(nextTask.ownerWindow, () => {
			ranSynchronously = true;
			nextTask.cancelSchedule = undefined;
			scheduledGenerationTasks.delete(nextTask);
			if (nextTask.cancelled) {
				processQueue();
				return;
			}
			nextTask.started = true;
			activeGenerations += 1;
			void nextTask.run();
			processQueue();
		});
		nextTask.cancelSchedule = ranSynchronously ? undefined : cancelSchedule;
	}
}

function scheduleGeneration(ownerWindow: Window, run: () => void): () => void {
	let completed = false;
	let idleHandle: number | undefined;
	const finish = (): void => {
		if (completed) return;
		completed = true;
		if (
			idleHandle !== undefined &&
			typeof ownerWindow.cancelIdleCallback === "function"
		) {
			ownerWindow.cancelIdleCallback(idleHandle);
		}
		globalThis.clearTimeout(fallbackHandle);
		run();
	};
	const fallbackHandle = globalThis.setTimeout(finish, IDLE_GENERATION_TIMEOUT_MS);

	if (typeof ownerWindow.requestIdleCallback === "function") {
		idleHandle = ownerWindow.requestIdleCallback(finish, {
			timeout: IDLE_GENERATION_TIMEOUT_MS,
		});
	} else {
		ownerWindow.setTimeout(finish, 0);
	}

	return () => {
		if (completed) return;
		completed = true;
		if (
			idleHandle !== undefined &&
			typeof ownerWindow.cancelIdleCallback === "function"
		) {
			ownerWindow.cancelIdleCallback(idleHandle);
		}
		globalThis.clearTimeout(fallbackHandle);
	};
}

function enqueue<T>(
	task: () => Promise<T>,
	ownerWindow: Window,
	signal?: AbortSignal,
): Promise<T | undefined> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const settle = (handler: () => void): void => {
			if (settled) return;
			settled = true;
			queueTask.cleanup();
			handler();
		};
		const run = async (): Promise<void> => {
			try {
				const result = await task();
				queueTask.resolve(result);
			} catch (e) {
				queueTask.reject(e);
			} finally {
				activeGenerations = Math.max(activeGenerations - 1, 0);
				processQueue();
			}
		};
		const queueTask: GenerationQueueTask = {
			cancelled: false,
			started: false,
			ownerWindow,
			cancelSchedule: undefined,
			cleanup: () => {},
			reject: (error) => settle(() => reject(error)),
			resolve: (value) => settle(() => resolve(value as T | undefined)),
			run,
		};
		if (signal?.aborted) {
			queueTask.resolve(undefined);
			return;
		}
		if (signal) {
			const onAbort = (): void => {
				if (queueTask.started) return;
				queueTask.cancelled = true;
				const queuedIndex = generationQueue.indexOf(queueTask);
				if (queuedIndex >= 0) generationQueue.splice(queuedIndex, 1);
				scheduledGenerationTasks.delete(queueTask);
				queueTask.cancelSchedule?.();
				queueTask.cancelSchedule = undefined;
				queueTask.resolve(undefined);
				processQueue();
			};
			signal.addEventListener("abort", onAbort, { once: true });
			queueTask.cleanup = () => signal.removeEventListener("abort", onAbort);
		}
		generationQueue.push(queueTask);
		processQueue();
	});
}

export function clearVideoPreviewQueue(): void {
	for (const task of generationQueue.splice(0)) {
		task.cancelled = true;
		task.cancelSchedule?.();
		task.resolve(undefined);
	}
	for (const task of scheduledGenerationTasks) {
		task.cancelled = true;
		task.cancelSchedule?.();
		task.resolve(undefined);
	}
	scheduledGenerationTasks.clear();
}

async function generateVideoThumbnail(
	file: TFile,
	ownerDocument: Document,
	seekTo = 0.0,
	maxThumbnailWidth = 150,
	signal?: AbortSignal,
): Promise<VideoThumbnailResult | undefined> {
	if (signal?.aborted) return undefined;
	const ownerWindow = ownerDocument.defaultView;
	if (!ownerWindow) return undefined;

	return enqueue(
		() =>
			generateVideoThumbnailInternal(
				file,
				ownerDocument,
				seekTo,
				maxThumbnailWidth,
				signal,
			),
		ownerWindow,
		signal,
	);
}

async function generateVideoThumbnailInternal(
	file: TFile,
	ownerDocument: Document,
	seekTo: number,
	maxWidth: number,
	signal?: AbortSignal,
): Promise<VideoThumbnailResult | undefined> {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve(undefined);
			return;
		}

		const ownerWindow = ownerDocument.defaultView;
		if (!ownerWindow) {
			resolve(undefined);
			return;
		}

		const videoUrl = file.vault.getResourcePath(file);
		const video = ownerDocument.createElement("video");
		const canvas = ownerDocument.createElement("canvas");
		let timeoutId = 0;
		let settled = false;

		const cleanup = (): void => {
			if (signal) signal.removeEventListener("abort", onAbort);
			ownerWindow.clearTimeout(timeoutId);
			video.pause();
			if (video.src.startsWith("blob:")) {
				URL.revokeObjectURL(video.src);
			}
			video.removeAttribute("src");
			video.load();
			video.remove();
			canvas.remove();
		};

		const finish = (value: VideoThumbnailResult | undefined): void => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(value);
		};

		const onAbort = (): void => finish(undefined);
		if (signal) signal.addEventListener("abort", onAbort);

		video.preload = "metadata";
		video.src = videoUrl;
		video.crossOrigin = "anonymous";
		video.muted = true;
		video.playsInline = true;

		video.addEventListener("error", () => finish(undefined));

		video.addEventListener("loadedmetadata", () => {
			if (settled || signal?.aborted) return;
			video.currentTime = video.duration < seekTo ? 0 : seekTo;
		});

		video.addEventListener("seeked", () => {
			if (settled || signal?.aborted) {
				finish(undefined);
				return;
			}

			try {
				const ctx = canvas.getContext("2d", { alpha: false });
				if (!ctx) throw new Error("Could not get canvas context");

				let width = video.videoWidth;
				let height = video.videoHeight;
				if (width > maxWidth) {
					height = (height * maxWidth) / width;
					width = maxWidth;
				}

				canvas.width = width;
				canvas.height = height;
				ctx.drawImage(video, 0, 0, width, height);

				canvas.toBlob(
					(blob) => {
						if (signal?.aborted || !blob) {
							finish(undefined);
							return;
						}
						finish({
							url: URL.createObjectURL(blob),
							byteSize: blob.size,
						});
					},
					"image/jpeg",
					0.7,
				);
			} catch {
				finish(undefined);
			}
		});

		timeoutId = ownerWindow.setTimeout(() => {
			console.warn(`Thumbnail generation timed out for ${file.path}`);
			finish(undefined);
		}, 3000);
	});
}

export async function generateVideoPreview(
	file: TFile,
	signal?: AbortSignal,
	ownerDocument: Document | null = typeof document === "undefined" ? null : document,
): Promise<PreviewData | undefined> {
	try {
		if (signal?.aborted || !ownerDocument) return undefined;
		const thumbnail = await generateVideoThumbnail(
			file,
			ownerDocument,
			0.1,
			320,
			signal,
		);
		if (thumbnail) {
			return {
				type: "image",
				content: thumbnail.url,
				byteSize: thumbnail.byteSize,
			};
		}
	} catch (error) {
		console.warn(`Could not generate thumbnail for ${file.path}:`, error);
	}
	return undefined;
}
