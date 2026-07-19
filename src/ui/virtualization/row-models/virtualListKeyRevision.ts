export function resolveVirtualListKeyRevision(params: {
	explicitRevision?: unknown;
	resolver: unknown;
}): unknown {
	return params.explicitRevision ?? params.resolver;
}
