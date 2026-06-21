declare module "*.worker" {
	const createWorker: () => Worker;
	export default createWorker;
}

declare module "*.worker.ts" {
	const createWorker: () => Worker;
	export default createWorker;
}

declare module "features/search/searchFilter.worker" {
	const createWorker: () => Worker;
	export default createWorker;
}
