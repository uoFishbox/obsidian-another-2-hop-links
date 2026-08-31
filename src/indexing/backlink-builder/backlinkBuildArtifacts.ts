import type { TagIndex } from "../indexState";
import type { LinkIndex } from "../link-index/linkIndex";

export interface BacklinksBuildArtifacts {
	linkIndex: LinkIndex;
	tagIndex: TagIndex;
}
