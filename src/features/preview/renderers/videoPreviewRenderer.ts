import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";

// 同時生成数を制限するための簡易キュー（ブラウザのデコーダー枯渇を防ぐ）
const MAX_CONCURRENT_GENERATIONS = 3;
let activeGenerations = 0;
interface VideoThumbnailResult {
	url: string;
	byteSize: number;
}

interface GenerationQueueTask {
	cancelled: boolean;
	resolve: (value: unknown) => void;
	run: () => Promise<void>;
}
const generationQueue: GenerationQueueTask[] = [];
const scheduledGenerationTasks = new Set<GenerationQueueTask>();

function processQueue() {
	if (
		activeGenerations + scheduledGenerationTasks.size >=
			MAX_CONCURRENT_GENERATIONS ||
		generationQueue.length === 0
	) {
		return;
	}

	// ブラウザのアイドル時間を待ってから実行する
	// requestIdleCallbackの型定義がない環境へのフォールバック付き
	const schedule = (window as any).requestIdleCallback || window.setTimeout;
	const nextTask = generationQueue.shift();
	if (!nextTask) {
		return;
	}
	scheduledGenerationTasks.add(nextTask);

	schedule(() => {
		scheduledGenerationTasks.delete(nextTask);
		if (nextTask.cancelled) {
			processQueue();
			return;
		}
		activeGenerations++;
		void nextTask.run();
	});
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		const run = async () => {
			try {
				const result = await task();
				resolve(result);
			} catch (e) {
				reject(e);
			} finally {
				activeGenerations = Math.max(activeGenerations - 1, 0);
				processQueue();
			}
		};
		const queueTask = {
			cancelled: false,
			resolve: resolve as (value: unknown) => void,
			run,
		};
		generationQueue.push(queueTask);
		processQueue();
	});
}

export function clearVideoPreviewQueue(): void {
	for (const task of generationQueue.splice(0)) {
		task.cancelled = true;
		task.resolve(undefined);
	}
	for (const task of scheduledGenerationTasks) {
		task.cancelled = true;
		task.resolve(undefined);
	}
	scheduledGenerationTasks.clear();
	activeGenerations = 0;
}

async function generateVideoThumbnail(
	file: TFile,
	seekTo = 0.0,
	maxThumbnailWidth = 150, // サムネイル用の幅制限。これを指定すると劇的に速くなる。
	signal?: AbortSignal,
): Promise<VideoThumbnailResult | undefined> {
	if (signal?.aborted) return undefined;
	// キュー経由で実行
	return enqueue(() =>
		generateVideoThumbnailInternal(file, seekTo, maxThumbnailWidth, signal),
	);
}

async function generateVideoThumbnailInternal(
	file: TFile,
	seekTo: number,
	maxWidth: number,
	signal?: AbortSignal,
): Promise<VideoThumbnailResult | undefined> {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve(undefined);
			return;
		}

		const videoUrl = file.vault.getResourcePath(file);
		const video = document.createElement("video");
		const canvas = document.createElement("canvas");
		let timeoutId: number;
		let settled = false;

		const cleanup = () => {
			if (signal) {
				signal.removeEventListener("abort", onAbort);
			}
			clearTimeout(timeoutId);
			video.pause();
			if (video.src.startsWith("blob:")) {
				URL.revokeObjectURL(video.src);
			}
			video.removeAttribute("src");
			video.load();
			video.remove();
			canvas.remove();
		};

		const finish = (value: VideoThumbnailResult | undefined) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			resolve(value);
		};

		// キャンセルイベントのハンドリング
		const onAbort = () => {
			finish(undefined);
		};

		if (signal) {
			signal.addEventListener("abort", onAbort);
		}

		// 重要な設定: メタデータのみ読み込む
		video.preload = "metadata";
		video.src = videoUrl;
		video.crossOrigin = "anonymous";
		video.muted = true;
		video.playsInline = true;

		// エラーハンドリング
		video.addEventListener("error", () => {
			// エラー時は reject せず undefined で解決し、UI側でフォールバックさせる
			finish(undefined);
		});

		// メタデータ読み込み完了時
		video.addEventListener("loadedmetadata", () => {
			if (settled || signal?.aborted) {
				return;
			}

			// 指定時間が動画長を超えている場合のガード
			if (video.duration < seekTo) {
				video.currentTime = 0;
			} else {
				video.currentTime = seekTo;
			}
		});

		// シーク完了時（描画可能状態）
		video.addEventListener("seeked", () => {
			if (settled || signal?.aborted) {
				finish(undefined);
				return;
			}

			try {
				const ctx = canvas.getContext("2d", {
					alpha: false, // アルファチャンネル不要を明示して高速化
				});

				if (!ctx) {
					throw new Error("Could not get canvas context");
				}

				// アスペクト比を維持しつつリサイズ計算
				let width = video.videoWidth;
				let height = video.videoHeight;

				if (width > maxWidth) {
					height = (height * maxWidth) / width;
					width = maxWidth;
				}

				canvas.width = width;
				canvas.height = height;

				// リサイズして描画
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
					0.7, // 画質を少し下げることでも高速化とメモリ節約を図る
				);
			} catch (e) {
				finish(undefined);
			}
		});

		// タイムアウト処理 (3秒に短縮)
		timeoutId = window.setTimeout(() => {
			console.warn(`Thumbnail generation timed out for ${file.path}`);
			finish(undefined);
		}, 3000);

		// 読み込み開始（load()を明示的に呼ぶ必要がある場合がある）
		// video.load(); // preload="metadata" と src 設定だけで基本は動く
	});
}

export async function generateVideoPreview(
	file: TFile,
	signal?: AbortSignal,
): Promise<PreviewData | undefined> {
	try {
		if (signal?.aborted) return undefined;
		// maxWidthを指定して呼び出し
		const thumbnail = await generateVideoThumbnail(file, 0.1, 320, signal);
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
