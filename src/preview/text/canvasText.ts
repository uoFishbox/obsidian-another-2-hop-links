export type CanvasEntry = {
	id?: string;
	type: "text" | "file" | "link" | "group";
	value: string;
};

function safeJsonParse(s: string): unknown {
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}

function cleanCanvasText(s: string): string {
	return s.replace(/\r\n?/g, "\n").trim();
}

function pickCanvasEntry(n: unknown): CanvasEntry | null {
	const node = n as Record<string, unknown>;
	const type =
		typeof node?.type === "string"
			? (node.type.toLowerCase() as CanvasEntry["type"])
			: null;
	const id = typeof node?.id === "string" ? node.id : undefined;

	if (type === "text" && typeof node.text === "string")
		return { id, type, value: cleanCanvasText(node.text) };
	if (type === "file" && typeof node.file === "string")
		return {
			id,
			type,
			value: cleanCanvasText(
				node.file + (typeof node.subpath === "string" ? node.subpath : ""),
			),
		};
	if (type === "link" && typeof node.url === "string")
		return { id, type, value: cleanCanvasText(node.url) };
	if (type === "group" && typeof node.label === "string")
		return { id, type, value: cleanCanvasText(node.label) };

	return null;
}

export function canvasToSearchText(input: string | unknown): {
	entries: CanvasEntry[];
	searchableText: string;
} {
	const data: unknown = typeof input === "string" ? safeJsonParse(input) : input;
	const nodes: unknown[] = Array.isArray((data as Record<string, unknown>)?.nodes)
		? ((data as Record<string, unknown>).nodes as unknown[])
		: [];

	const entries: CanvasEntry[] = [];
	const textParts: string[] = [];

	for (const node of nodes) {
		const entry = pickCanvasEntry(node);
		if (!entry) continue;

		entries.push(entry);
		textParts.push(entry.value);
	}

	return {
		entries,
		searchableText: textParts.join("\n"),
	};
}
