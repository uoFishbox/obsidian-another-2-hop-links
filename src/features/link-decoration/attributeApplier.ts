export interface AttributeApplierOptions {
	enableDebugLog?: boolean;
}

export interface AttributeOperationOptions extends AttributeApplierOptions {
	attrName: string;
	attrValue: string;
	shouldApply: boolean;
}

export function applyAttributeToElements(
	elements: Iterable<HTMLElement>,
	options: AttributeOperationOptions,
): void {
	if (options.shouldApply) {
		addAttributeToElements(elements, options);
		return;
	}

	removeAttributeFromElements(elements, options);
}

export function clearAttributeFromContainer(
	container: HTMLElement,
	attrName: string,
	options: AttributeApplierOptions = {},
): void {
	const elements = container.querySelectorAll<HTMLElement>(`[${attrName}]`);
	removeAttributeFromElements(elements, {
		attrName,
		enableDebugLog: options.enableDebugLog,
	});
}

function addAttributeToElements(
	elements: Iterable<HTMLElement>,
	options: AttributeOperationOptions,
): void {
	for (const el of elements) {
		if (el.getAttribute(options.attrName) === options.attrValue) {
			continue;
		}

		el.setAttribute(options.attrName, options.attrValue);
	}
}

function removeAttributeFromElements(
	elements: Iterable<HTMLElement>,
	options: Pick<AttributeOperationOptions, "attrName" | "enableDebugLog">,
): void {
	for (const el of elements) {
		if (!el.hasAttribute(options.attrName)) {
			continue;
		}

		el.removeAttribute(options.attrName);
	}
}
