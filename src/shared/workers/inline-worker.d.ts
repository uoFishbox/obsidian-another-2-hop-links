declare module "*.worker" {
	const createWorker: () => Worker;
	export default createWorker;
}

declare module "*.worker.ts" {
	const createWorker: () => Worker;
	export default createWorker;
}

declare module "search/searchFilter.worker" {
	const createWorker: () => Worker;
	export default createWorker;
}
