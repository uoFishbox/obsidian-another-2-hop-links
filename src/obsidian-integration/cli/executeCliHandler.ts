import { z } from "zod";
import type { PluginHost } from "obsidian-integration/pluginHost";
import { TwoHopLinksView, TWO_HOP_LINKS_VIEW_TYPE } from "two-hop/ui/TwoHopLinksView";
import { inspectCliPage, runCliQuery, type CliQueryAction } from "./cliQueries";
import { replaceCliLinks } from "./cliReplaceLinks";
import {
	cliBoolean,
	cliFailure,
	findCliFile,
	notePath,
	paginationShape,
	searchShape,
	type CliContext,
	type CliResult,
} from "./cliProtocol";

export type CliAction =
	| CliQueryAction
	| "inspectPage"
	| "replaceLinks"
	| "openRelatedPagesView";

const pageSchema = z.object({ ...paginationShape, path: notePath });
const querySchema = z.object({
	...paginationShape,
	path: notePath,
	query: searchShape.query,
	or: cliBoolean,
});
const relatedPagesSchema = z.object({
	...paginationShape,
	path: notePath,
	query: z.undefined().optional(),
	or: cliBoolean,
});
const replaceLinksSchema = z.object({
	from: notePath,
	to: notePath,
	dryRun: cliBoolean,
});
const openViewSchema = z.object({ path: notePath });

/** Validates and executes one lazily loaded CLI action. */
export async function executeCliHandler(
	plugin: PluginHost,
	signal: AbortSignal,
	action: CliAction,
	params: unknown,
): Promise<CliResult> {
	if (signal.aborted) {
		return cliFailure("cancelled", "Plugin unloaded");
	}

	const context: CliContext = { host: plugin, signal };
	switch (action) {
		case "list1hopLinks":
		case "list2hopLinks": {
			const parsed = relatedPagesSchema.safeParse(params);
			if (!parsed.success) return invalidParams(parsed.error.message);
			return runCliQuery(context, action, parsed.data);
		}
		case "search1hopLinks":
		case "search2hopLinks": {
			const parsed = querySchema.safeParse(params);
			if (!parsed.success) return invalidParams(parsed.error.message);
			return runCliQuery(context, action, parsed.data);
		}
		case "inspectPage": {
			const parsed = pageSchema.safeParse(params);
			if (!parsed.success) return invalidParams(parsed.error.message);
			return inspectCliPage(context, parsed.data);
		}
		case "replaceLinks": {
			const parsed = replaceLinksSchema.safeParse(params);
			if (!parsed.success) return invalidParams(parsed.error.message);
			return replaceCliLinks(context, parsed.data);
		}
		case "openRelatedPagesView": {
			const parsed = openViewSchema.safeParse(params);
			if (!parsed.success) return invalidParams(parsed.error.message);
			return openRelatedPagesView(plugin, parsed.data.path);
		}
	}
}

async function openRelatedPagesView(
	plugin: PluginHost,
	path: string,
): Promise<CliResult<{ path: string }>> {
	const found = findCliFile(plugin.app, path);
	if (!found.ok) return found;

	const leaf = plugin.app.workspace.getLeaf("tab");
	await leaf.setViewState({ type: TWO_HOP_LINKS_VIEW_TYPE, active: true });
	if (!(leaf.view instanceof TwoHopLinksView)) {
		return cliFailure("not-ready", "Two-hop view could not be opened");
	}
	leaf.view.renderForFile(found.file);
	return { ok: true, path };
}

function invalidParams(message: string): CliResult {
	return cliFailure("invalid-params", message);
}
