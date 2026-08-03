import type { IssueScene } from "../shared/protocol.ts";

export type IssueScenePreview = {
  scene: IssueScene;
  originalSource?: string;
  annotatedSource?: string;
};

export type IssueSceneCollection = {
  all: IssueScenePreview[];
  included: IssueScenePreview[];
};
