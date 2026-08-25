/**
 * SourceMap 逆向映射与源码级增强模块
 *
 * 对外统一出口：提供 SourceMapCoordinator 门面与相关协议类型
 */
export {
  SourceMapCoordinator,
  mergeIntervals,
  isTimeInIntervals,
} from "./sourcemap-coordinator.js";
export type {
  SourceMappedLocation,
  SourceSnippetContext,
} from "../shared/protocol.js";
export type { EnrichOptions, TimeInterval } from "./sourcemap-coordinator.js";
