import type { LinkCache } from "obsidian";
import { resolveLinkDestination } from "indexing/link-resolution/linkResolution";
import { defaultYieldToMainThread } from "indexing/timeSlicing";
import {
	cliFailure,
	findCliFile,
	type CliContext,
	type CliResult,
} from "./cliProtocol";

/** Replaces cached Markdown links/embeds, checking their source text before each write. */
export async function replaceCliLinks(
	context: CliContext,
	params: { from: string; to: string; dryRun: boolean },
): Promise<CliResult> {
	if (params.from === params.to)
		return cliFailure("invalid-params", "from and to must differ");
	const { app, indexingService } = context.host;
	await indexingService.awaitIdle();
	if (!indexingService.isReady())
		return cliFailure("not-ready", "Link index is still initializing");
	const target = findCliFile(app, params.to);
	const candidates = new Map(
		indexingService
			.getUniqueBacklinkSourcesForLink(params.from)
			.map((link) => [link.sourceFile.path, link.sourceFile]),
	);
	const updated: string[] = [];
	const failed: { path: string; reason: string }[] = [];
	let linkCount = 0;
	let inspected = 0;
	for (const file of candidates.values()) {
		if (file.extension !== "md") continue;
		if (context.signal.aborted)
			return {
				...cliFailure("cancelled", "Plugin unloaded"),
				details: { updated, failed },
			};
		if (++inspected % 10 === 0) await defaultYieldToMainThread();
		const cache = app.metadataCache.getFileCache(file);
		const refs = [...(cache?.links ?? []), ...(cache?.embeds ?? [])]
			.filter((ref) => {
				const resolved = resolveLinkDestination(
					app.metadataCache,
					ref,
					file.path,
				);
				return (resolved.file?.path ?? resolved.lookupPath) === params.from;
			})
			.sort((a, b) => b.position.start.offset - a.position.start.offset);
		if (refs.length === 0) continue;
		try {
			const before = await app.vault.read(file);
			let after = before;
			let lastStart = before.length;
			let valid = true;
			for (const ref of refs) {
				const start = ref.position.start.offset;
				const end = ref.position.end.offset;
				if (
					start < 0 ||
					end > lastStart ||
					before.slice(start, end) !== ref.original
				) {
					valid = false;
					break;
				}
				const anchor = ref.link.includes("#")
					? ref.link.slice(ref.link.indexOf("#"))
					: "";
				const replacement = target.ok
					? app.fileManager.generateMarkdownLink(
							target.file,
							file.path,
							anchor,
							ref.displayText,
						)
					: `[[${params.to.slice(0, -3)}${anchor}${linkAlias(ref)}]]`;
				after =
					after.slice(0, start) +
					(ref.original.startsWith("!") ? "!" : "") +
					replacement +
					after.slice(end);
				lastStart = start;
			}
			if (!valid) {
				failed.push({
					path: file.path,
					reason: "Metadata is stale; retry after indexing",
				});
				continue;
			}
			if (context.signal.aborted)
				return {
					...cliFailure("cancelled", "Plugin unloaded"),
					details: { updated, failed },
				};
			if (after === before) continue;
			if (!params.dryRun) {
				let applied = false;
				const originalPath = file.path;
				await app.vault.process(file, (current) => {
					if (
						context.signal.aborted ||
						current !== before ||
						file.path !== originalPath
					)
						return current;
					applied = true;
					return after;
				});
				if (!applied) {
					failed.push({
						path: file.path,
						reason: "File changed before write",
					});
					continue;
				}
			}
			updated.push(file.path);
			linkCount += refs.length;
		} catch (error) {
			failed.push({
				path: file.path,
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}
	const result = { dryRun: params.dryRun, updated, linkCount, failed };
	return failed.length
		? {
				...cliFailure(
					"conflict",
					"Some files could not be updated; inspect updated and failed before retrying",
				),
				...result,
			}
		: { ok: true, ...result };
}

function linkAlias(ref: LinkCache): string {
	return ref.displayText ? `|${ref.displayText.replace(/[\[\]|\r\n]/g, "")}` : "";
}
