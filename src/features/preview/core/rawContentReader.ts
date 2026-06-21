import type { TFile } from "obsidian";
import type { IVault } from "types/obsidian";
import { getFileContent } from "../utils/previewUtils";

function createAbortError(): DOMException {
	return new DOMException("Raw content read aborted", "AbortError");
}

export function readRawContent(
	file: TFile,
	vault: IVault,
	signal?: AbortSignal,
): Promise<string> {
	if (signal?.aborted) {
		return Promise.reject(createAbortError());
	}

	return new Promise<string>((resolve, reject) => {
		let settled = false;
		let onAbort = () => {};

		const cleanup = (): void => {
			if (signal) {
				signal.removeEventListener("abort", onAbort);
			}
		};

		const settle = (handler: () => void): void => {
			if (settled) {
				return;
			}

			settled = true;
			cleanup();
			handler();
		};

		onAbort = () => {
			settle(() => reject(createAbortError()));
		};

		if (signal) {
			signal.addEventListener("abort", onAbort, { once: true });
		}

		getFileContent(file, vault).then(
			(content) => settle(() => resolve(content)),
			(error) => settle(() => reject(error)),
		);
	});
}
