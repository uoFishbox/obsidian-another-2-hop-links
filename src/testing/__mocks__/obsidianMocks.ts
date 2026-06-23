export class TFile {
	path: string;
	name: string;
	basename: string;
	extension: string;
	stat: { ctime: number; mtime: number; size: number };
	vault: any;
	parent: any;

	constructor() {
		this.path = "";
		this.name = "";
		this.basename = "";
		this.extension = "";
		this.stat = { ctime: 0, mtime: 0, size: 0 };
		this.vault = {};
		this.parent = null;
	}
}

export class App {}

export class FileSystemAdapter {
	getBasePath(): string {
		return "";
	}
}

export const Platform = {
	isDesktopApp: true,
};

export class Component {
	load(): void {}
	unload(): void {}
	register(): void {}
	registerDomEvent(): void {}
	registerEvent(): void {}
	registerInterval(): number {
		return 0;
	}
}

type MenuItemCallback = (item: MenuItem) => void;

export class MenuItem {
	title = "";
	icon = "";
	section = "";
	clickHandler: (() => void) | null = null;

	setTitle(title: string): this {
		this.title = title;
		return this;
	}

	setIcon(icon: string): this {
		this.icon = icon;
		return this;
	}

	setSection(section: string): this {
		this.section = section;
		return this;
	}

	onClick(callback: () => void): this {
		this.clickHandler = callback;
		return this;
	}
}

export class Menu {
	items: MenuItem[] = [];
	separatorCount = 0;
	shownAt: MouseEvent | null = null;

	addItem(callback: MenuItemCallback): this {
		const item = new MenuItem();
		callback(item);
		this.items.push(item);
		return this;
	}

	addSeparator(): this {
		this.separatorCount += 1;
		return this;
	}

	showAtMouseEvent(event: MouseEvent): this {
		this.shownAt = event;
		return this;
	}
}

// リンクパス取得関数のmock
export function getLinkpath(linkText: string): string {
	// [[link#section|alias]] → link#section
	// [[link|alias]] → link
	// [[link#section]] → link#section
	// [[link]] → link
	const match = linkText.match(/^\[\[([^\]|]+)/);
	if (match) {
		return match[1].split("#")[0];
	}
	return linkText.split("#")[0];
}

// パス正規化関数のmock
export function normalizePath(path: string): string {
	// バックスラッシュをスラッシュに変換
	// 連続するスラッシュを1つにまとめる
	// 先頭と末尾のスラッシュを削除
	return path
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\/+|\/+$/g, "");
}

export function parseLinktext(linktext: string): { path: string; subpath: string } {
	const [pathWithBlock] = linktext.split("|");
	const subpathMatch = pathWithBlock.match(/([#^].*)$/);
	const path = pathWithBlock.replace(/[#^].*$/, "");

	return {
		path,
		subpath: subpathMatch?.[1] ?? "",
	};
}
