import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { t } from "../src/shared/i18n.ts";
import { exportVideoClip } from "../src/preview/video-clip-exporter.ts";

const EXPORTER_SOURCE = resolve(
  process.cwd(),
  "src/preview/video-clip-exporter.ts"
);

// 改动前存在于 video-clip-exporter.ts 的硬编码中文用户可见文案（toast）
const HARDCODED_CHINESE = [
  "暂无有效视频录像，无法导出片段",
  "视频剪辑时间区间无效",
  "正在生成前后 5s 视频片段，请稍候…",
  "Canvas 初始化失败",
  "已成功触发下载 MP4 视频片段",
  "下载失败：",
  "导出视频片段失败：",
];

test("视频片段导出器的用户可见文案必须走 i18n（禁止硬编码中文）", () => {
  const source = readFileSync(EXPORTER_SOURCE, "utf8");
  for (const literal of HARDCODED_CHINESE) {
    assert.ok(
      !source.includes(`"${literal}"`) && !source.includes(`'${literal}'`),
      `video-clip-exporter.ts 不得硬编码 '${literal}'，应通过 t() 提供`
    );
  }
});

test("无有效录像时 onNotify 收到本地化消息而非硬编码中文", async () => {
  const notified: string[] = [];
  // video 为空对象：命中"无有效视频录像"分支，在创建 Canvas 之前即返回
  await exportVideoClip(
    { duration: 0 } as HTMLVideoElement,
    0,
    1,
    "clip.mp4",
    (msg) => notified.push(msg)
  );
  assert.deepEqual(notified, [t("clipExportNoValidVideo")]);
  assert.ok(
    !notified.some((msg) => msg.includes("暂无有效视频录像")),
    "不得返回硬编码中文消息"
  );
});

test("剪辑时间区间无效时 onNotify 收到本地化消息而非硬编码中文", async () => {
  const notified: string[] = [];
  // start 8s > end 2s：命中"时间区间无效"分支，在创建 Canvas 之前即返回
  await exportVideoClip(
    { duration: 10 } as HTMLVideoElement,
    8,
    2,
    "clip.mp4",
    (msg) => notified.push(msg)
  );
  assert.deepEqual(notified, [t("clipExportRangeInvalid")]);
  assert.ok(
    !notified.some((msg) => msg.includes("视频剪辑时间区间无效")),
    "不得返回硬编码中文消息"
  );
});
