export interface AttributeApplierOptions {
	enableDebugLog?: boolean;
}

export interface AttributeOperationOptions extends AttributeApplierOptions {
	attrName: string;
	attrValue: string;
	shouldApply: boolean;
}

export function applyAttributeToElement(
	element: HTMLElement,
	options: AttributeOperationOptions,
): void {
	if (options.shouldApply) {
		addAttributeToElement(element, options);
		return;
	}

	removeAttributeFromElement(element, options);
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

function addAttributeToElement(
	element: HTMLElement,
	options: AttributeOperationOptions,
): void {
	if (element.getAttribute(options.attrName) === options.attrValue) {
		return;
	}

	element.setAttribute(options.attrName, options.attrValue);
}

function removeAttributeFromElement(
	element: HTMLElement,
	options: Pick<AttributeOperationOptions, "attrName" | "enableDebugLog">,
): void {
	if (!element.hasAttribute(options.attrName)) {
		return;
	}

	element.removeAttribute(options.attrName);
}

function addAttributeToElements(
	elements: Iterable<HTMLElement>,
	options: AttributeOperationOptions,
): void {
	for (const el of elements) {
		addAttributeToElement(el, options);
	}
}

function removeAttributeFromElements(
	elements: Iterable<HTMLElement>,
	options: Pick<AttributeOperationOptions, "attrName" | "enableDebugLog">,
): void {
	for (const el of elements) {
		removeAttributeFromElement(el, options);
	}
}
