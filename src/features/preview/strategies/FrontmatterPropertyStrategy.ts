import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import type { PreviewContext, PreviewStrategy } from "../core/PreviewStrategy";

/**
 * 設定で指定されたfrontmatterプロパティの値を優先的にプレビュー表示する戦略
 */
export function createFrontmatterPropertyStrategy(): PreviewStrategy {
	return {
		canHandle(file: TFile, context?: PreviewContext): boolean {
			// Markdownファイルで、設定でプロパティキーが指定されている場合のみ処理
			if (file.extension !== "md") return false;
			if (!context?.settings?.priorityFrontmatterKeyForPreview) return false;
			
			const key = context.settings.priorityFrontmatterKeyForPreview.trim();
			if (!key) return false;

			// frontmatterに指定されたキーが存在するかチェック
			const cache = context.metadataCache.getFileCache(file);
			const frontmatter = cache?.frontmatter;
			if (!frontmatter) return false;

			return key in frontmatter;
		},

		async generate(
			file: TFile,
			context: PreviewContext,
			signal?: AbortSignal,
		): Promise<PreviewData | undefined> {
			if (signal?.aborted) return undefined;

			const key = context.settings?.priorityFrontmatterKeyForPreview?.trim();
			if (!key) return undefined;

			const cache = context.metadataCache.getFileCache(file);
			const value = cache?.frontmatter?.[key];

			// 値が存在しない、または空の場合はundefinedを返して次の戦略へ
			if (value === undefined || value === null || value === "") {
				return undefined;
			}

			// 値をプレーンテキストとして変換
			let content: string;
			if (typeof value === "string") {
				content = value;
			} else if (Array.isArray(value)) {
				// 配列の場合はカンマ区切りで結合
				content = value.join(", ");
			} else if (typeof value === "object") {
				// オブジェクトの場合はJSON文字列化（レアケース）
				content = JSON.stringify(value);
			} else {
				// その他の型（number, booleanなど）
				content = String(value);
			}

			// 空文字チェック
			const trimmedContent = content.trim();
			if (!trimmedContent) {
				return undefined;
			}

			return { type: "text", content: trimmedContent };
		},
	};
}

export const frontmatterPropertyStrategy: PreviewStrategy =
	createFrontmatterPropertyStrategy();

export default createFrontmatterPropertyStrategy;
