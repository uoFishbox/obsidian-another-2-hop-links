export type Result<T, E> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: E };

export type VirtualListInputError =
	| {
			readonly type: "missing-array-source-key-resolver";
	  }
	| {
			readonly type: "missing-item-render-revision";
			readonly sourceKey: string;
			readonly cellKey: string;
	  };

export function formatVirtualListInputError(error: VirtualListInputError): string {
	switch (error.type) {
		case "missing-array-source-key-resolver":
			return "getKey is required for array-backed sources.";
		case "missing-item-render-revision":
			return `Missing item render revision for sourceKey=${JSON.stringify(
				error.sourceKey,
			)} cellKey=${JSON.stringify(error.cellKey)}.`;
	}
}
