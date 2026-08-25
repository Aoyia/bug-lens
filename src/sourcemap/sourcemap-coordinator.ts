import { SourceMapWorkerClient } from "./internal/sourcemap-worker-client.js";
import type {
  ConsoleEntry,
  NetworkEntry,
  SourceMappedLocation,
  InteractionRecord,
  IssueScene,
} from "../shared/protocol.js";

export interface TimeInterval {
  start: number;
  end: number;
}

export interface EnrichOptions {
  snippetLinesBefore?: number;
  snippetLinesAfter?: number;
  timeoutMs?: number;
  interactions?: InteractionRecord[];
  issueScenes?: IssueScene[];
  sceneWindowMs?: number;
  interactionWindowMs?: number;
  /** 内部预计算的时空区间，避免反复遍历与重复计算 */
  _preparedIntervals?: {
    sceneIntervals: TimeInterval[];
    interactionIntervals: TimeInterval[];
  };
}

/**
 * 将微秒或毫秒时间戳归一化为毫秒
 */
function toEpochMs(v: number | undefined): number {
  if (!v) return 0;
  return v > 1e12 ? v / 1000 : v;
}

/**
 * 区间合并算法：将重叠或相邻的时间区间合并为有序不相交区间，复杂度 O(K log K)
 */
export function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  if (intervals.length <= 1) return intervals;
  const valid = intervals.filter((it) => it.end >= it.start && it.start > 0);
  if (valid.length <= 1) return valid;

  valid.sort((a, b) => a.start - b.start);

  const merged: TimeInterval[] = [valid[0]];
  for (let i = 1; i < valid.length; i++) {
    const current = valid[i];
    const prev = merged[merged.length - 1];
    if (current.start <= prev.end) {
      prev.end = Math.max(prev.end, current.end);
    } else {
      merged.push(current);
    }
  }
  return merged;
}

/**
 * 二分查找算法：在有序不相交区间数组中检索目标时间戳，复杂度 O(log K)
 */
export function isTimeInIntervals(
  intervals: TimeInterval[],
  ts: number
): boolean {
  if (!intervals || intervals.length === 0 || ts <= 0) return false;
  let low = 0;
  let high = intervals.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const interval = intervals[mid];
    if (ts >= interval.start && ts <= interval.end) {
      return true;
    }
    if (ts < interval.start) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return false;
}

/**
 * 负责收集会话中的 ConsoleEntry 与 NetworkEntry 调用栈，
 * 采用【异常与时空现场驱动】策略进行精准准入过滤与 SourceMap 逆向映射。
 *
 * 性能优化（方案一）：
 * 1. 时空区间合并（Interval Merging）+ 二分查找检索 O(log K) 替代 O(N*K) 线性扫描；
 * 2. 查询坐标哈希去重（Query Deduplication）+ 结果 1:N 扇出，大幅缩减 IPC 传输与 Worker 查表计算。
 */
export class SourceMapCoordinator {
  private client: SourceMapWorkerClient;

  constructor(client?: SourceMapWorkerClient) {
    this.client = client ?? new SourceMapWorkerClient();
  }

  /**
   * 预处理并构建合并后的时空区间索引
   */
  public static prepareOptions(options?: EnrichOptions): EnrichOptions {
    if (!options) return {};
    if (options._preparedIntervals) return options;

    const sceneWindowMs = options.sceneWindowMs ?? 5000;
    const interactionWindowMs = options.interactionWindowMs ?? 2000;

    const rawSceneIntervals: TimeInterval[] = [];
    if (options.issueScenes && options.issueScenes.length > 0) {
      for (const scene of options.issueScenes) {
        const rawTs =
          scene.observedAtEpochMs ??
          scene.target?.capturedAtEpochMs ??
          (scene as any).createdAt;
        const sceneTs = toEpochMs(rawTs);
        if (sceneTs > 0) {
          rawSceneIntervals.push({
            start: sceneTs - sceneWindowMs,
            end: sceneTs + sceneWindowMs,
          });
        }
      }
    }

    const rawInteractionIntervals: TimeInterval[] = [];
    if (options.interactions && options.interactions.length > 0) {
      for (const inter of options.interactions) {
        const interTs = toEpochMs(inter.createdAt);
        if (interTs > 0) {
          rawInteractionIntervals.push({
            start: interTs,
            end: interTs + interactionWindowMs,
          });
        }
      }
    }

    return {
      ...options,
      _preparedIntervals: {
        sceneIntervals: mergeIntervals(rawSceneIntervals),
        interactionIntervals: mergeIntervals(rawInteractionIntervals),
      },
    };
  }

  /**
   * 判断单条 ConsoleEntry 是否符合 SourceMap 还原条件
   */
  public static shouldResolveConsole(
    entry: ConsoleEntry,
    options?: EnrichOptions
  ): boolean {
    // 1. 必须有脚本 URL 或堆栈
    const hasScriptUrl =
      Boolean(entry.url) ||
      (entry.stackTrace && entry.stackTrace.length > 0) ||
      Boolean(entry.lineNumber !== undefined && entry.lineNumber > 0);
    if (!hasScriptUrl) return false;

    // 2. 异常驱动：error 级别日志 100% 还原
    if (entry.level === "error") return true;

    // 3. 时空现场驱动：检查是否处于问题现场（IssueScene）前后窗口内
    const prepared = options?._preparedIntervals
      ? options
      : SourceMapCoordinator.prepareOptions(options);

    const sceneIntervals = prepared._preparedIntervals?.sceneIntervals;
    if (sceneIntervals && sceneIntervals.length > 0) {
      const ts = toEpochMs(entry.createdAt);
      if (isTimeInIntervals(sceneIntervals, ts)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 判断单条 NetworkEntry 是否符合 SourceMap 还原条件
   */
  public static shouldResolveNetwork(
    entry: NetworkEntry,
    options?: EnrichOptions
  ): boolean {
    const initiator = entry.initiator;
    if (!initiator) return false;
    const hasStack =
      Boolean(initiator.url) ||
      (initiator.stackTrace && initiator.stackTrace.length > 0) ||
      Boolean(initiator.concise?.topFrame?.url) ||
      (initiator.concise?.stack && initiator.concise.stack.length > 0);
    if (!hasStack) return false;

    // 1. 异常驱动：HTTP 4xx/5xx、CORS 错误、请求失败/取消 100% 抓取
    const isHttpError =
      entry.status !== undefined && (entry.status >= 400 || entry.status === 0);
    const hasNetworkError = Boolean(
      entry.error ||
      entry.canceled ||
      entry.corsErrorStatus ||
      entry.blockedReason
    );
    if (isHttpError || hasNetworkError) {
      return true;
    }

    // 2. 静态资源过滤：正常的 200 脚本/样式/图片/字体/文档等静态加载默认不解析，除非在交互/缺陷窗口内
    const rawType = (entry as any).resourceType ?? entry.type ?? "";
    const resourceType = String(rawType).toLowerCase();
    const isStaticAsset =
      resourceType === "script" ||
      resourceType === "stylesheet" ||
      resourceType === "image" ||
      resourceType === "font" ||
      resourceType === "media" ||
      resourceType === "document";

    // 3. 动态数据接口驱动：XHR / Fetch / 非 GET 请求（如 POST/PUT/DELETE）默认解析
    const isDynamicApi =
      resourceType === "fetch" ||
      resourceType === "xhr" ||
      (entry.method && entry.method.toUpperCase() !== "GET");

    if (isDynamicApi) {
      return true;
    }

    // 4. 时空与交互现场驱动（二分快速检索）
    const prepared = options?._preparedIntervals
      ? options
      : SourceMapCoordinator.prepareOptions(options);

    const entryTs = toEpochMs(entry.createdAt);

    // 4.1 交互现场命中检测 (O(log K))
    const interactionIntervals =
      prepared._preparedIntervals?.interactionIntervals;
    if (
      interactionIntervals &&
      isTimeInIntervals(interactionIntervals, entryTs)
    ) {
      return true;
    }

    // 4.2 缺陷现场命中检测 (O(log K))
    const sceneIntervals = prepared._preparedIntervals?.sceneIntervals;
    if (sceneIntervals && isTimeInIntervals(sceneIntervals, entryTs)) {
      return true;
    }

    if (isStaticAsset) {
      return false;
    }

    return false;
  }

  /**
   * 批量丰富并还原控制台日志与网络调用栈中的源码映射
   */
  public async enrichEntries(
    consoleEntries: ConsoleEntry[],
    networkEntries: NetworkEntry[],
    options?: EnrichOptions
  ): Promise<{
    consoleEntries: ConsoleEntry[];
    networkEntries: NetworkEntry[];
  }> {
    // 提前构建合并时空区间，使后续所有准入检测加速至 O(log K)
    const preparedOptions = SourceMapCoordinator.prepareOptions(options);

    // 坐标去重注册表 (Query Deduplication)
    const dedupItemsMap = new Map<
      string,
      {
        uniqueId: string;
        scriptUrl: string;
        line: number;
        column: number;
      }
    >();
    const keyToEntityIds = new Map<string, string[]>();

    const registerItem = (
      entityId: string,
      scriptUrl: string,
      line: number,
      column: number
    ) => {
      const key = `${scriptUrl}:::${line}:::${column}`;
      let entityList = keyToEntityIds.get(key);
      if (!entityList) {
        entityList = [];
        keyToEntityIds.set(key, entityList);
        const uniqueId = `uid_${dedupItemsMap.size}_${entityId}`;
        dedupItemsMap.set(key, {
          uniqueId,
          scriptUrl,
          line,
          column,
        });
      }
      entityList.push(entityId);
    };

    // 1. 筛选并收集需要解析的 Console 条目
    for (const entry of consoleEntries) {
      if (!SourceMapCoordinator.shouldResolveConsole(entry, preparedOptions))
        continue;

      if (entry.url && entry.lineNumber !== undefined) {
        registerItem(
          `console:${entry.id}:top`,
          entry.url,
          entry.lineNumber + 1,
          (entry.columnNumber ?? 0) + 1
        );
      }

      if (entry.stackTrace) {
        entry.stackTrace.forEach((frame, idx) => {
          if (frame.url && frame.lineNumber !== undefined) {
            registerItem(
              `console:${entry.id}:frame:${idx}`,
              frame.url,
              frame.lineNumber + 1,
              (frame.columnNumber ?? 0) + 1
            );
          }
        });
      }
    }

    // 2. 筛选并收集需要解析的 Network 条目
    for (const entry of networkEntries) {
      if (!SourceMapCoordinator.shouldResolveNetwork(entry, preparedOptions))
        continue;

      const initiator = entry.initiator;
      if (!initiator) continue;

      if (initiator.url && initiator.lineNumber !== undefined) {
        registerItem(
          `net:${entry.id}:initiator:top`,
          initiator.url,
          initiator.lineNumber + 1,
          (initiator.columnNumber ?? 0) + 1
        );
      }

      if (
        initiator.concise?.topFrame?.url &&
        initiator.concise.topFrame.lineNumber !== undefined
      ) {
        registerItem(
          `net:${entry.id}:concise:top`,
          initiator.concise.topFrame.url,
          initiator.concise.topFrame.lineNumber + 1,
          (initiator.concise.topFrame.columnNumber ?? 0) + 1
        );
      }

      if (initiator.concise?.stack) {
        initiator.concise.stack.forEach((frame, idx) => {
          if (frame.url && frame.lineNumber !== undefined) {
            registerItem(
              `net:${entry.id}:concise:stack:${idx}`,
              frame.url,
              frame.lineNumber + 1,
              (frame.columnNumber ?? 0) + 1
            );
          }
        });
      }
    }

    if (dedupItemsMap.size === 0) {
      return { consoleEntries, networkEntries };
    }

    // 3. 仅向 Worker 发送去重后的唯一坐标点（大幅缩减 IPC 传输与查表计算）
    const uniqueItemsToResolve = Array.from(dedupItemsMap.values()).map(
      (item) => ({
        id: item.uniqueId,
        scriptUrl: item.scriptUrl,
        line: item.line,
        column: item.column,
      })
    );

    const rawResults = await this.client.resolveBatch(uniqueItemsToResolve, {
      snippetLinesBefore: options?.snippetLinesBefore ?? 5,
      snippetLinesAfter: options?.snippetLinesAfter ?? 5,
      timeoutMs: options?.timeoutMs ?? 6000,
    });

    // 4. 1:N 结果扇出（Fan-Out）：将去重查询结果分发给所有对应的实体
    const results: Record<string, SourceMappedLocation> = {};
    for (const [key, entityIds] of keyToEntityIds.entries()) {
      const item = dedupItemsMap.get(key);
      if (!item) continue;
      const mapped = rawResults[item.uniqueId];
      if (mapped) {
        for (const entityId of entityIds) {
          results[entityId] = mapped;
        }
      }
    }

    // 5. 回填 Console 映射结果
    const enrichedConsole = consoleEntries.map((entry) => {
      const topMapped = results[`console:${entry.id}:top`];
      let updatedEntry = entry;
      if (topMapped) {
        updatedEntry = {
          ...updatedEntry,
          sourceMappedLocation: topMapped,
        };
      }

      if (entry.stackTrace) {
        const enrichedStack = entry.stackTrace.map((frame, idx) => {
          const frameMapped = results[`console:${entry.id}:frame:${idx}`];
          if (frameMapped) {
            return {
              ...frame,
              sourceMappedLocation: frameMapped,
            };
          }
          return frame;
        });
        updatedEntry = {
          ...updatedEntry,
          stackTrace: enrichedStack,
        };
      }

      return updatedEntry;
    });

    // 6. 回填 Network 映射结果
    const enrichedNetwork = networkEntries.map((entry) => {
      const initiator = entry.initiator;
      if (!initiator) return entry;

      let updatedInitiator = initiator;

      if (initiator.concise) {
        let updatedConcise = initiator.concise;
        const conciseTopMapped = results[`net:${entry.id}:concise:top`];
        if (conciseTopMapped && initiator.concise.topFrame) {
          updatedConcise = {
            ...updatedConcise,
            topFrame: {
              ...initiator.concise.topFrame,
              sourceMappedLocation: conciseTopMapped,
            },
          };
        }

        if (initiator.concise.stack) {
          const enrichedConciseStack = initiator.concise.stack.map(
            (frame, idx) => {
              const frameMapped =
                results[`net:${entry.id}:concise:stack:${idx}`];
              if (frameMapped) {
                return {
                  ...frame,
                  sourceMappedLocation: frameMapped,
                };
              }
              return frame;
            }
          );
          updatedConcise = {
            ...updatedConcise,
            stack: enrichedConciseStack,
          };
        }

        updatedInitiator = {
          ...updatedInitiator,
          concise: updatedConcise,
        };
      }

      return {
        ...entry,
        initiator: updatedInitiator,
      };
    });

    return {
      consoleEntries: enrichedConsole,
      networkEntries: enrichedNetwork,
    };
  }
}
