import assert from "node:assert/strict";
import test from "node:test";
import { formatBytes } from "../src/domain/byte-format.ts";

/**
 * 字节大小格式化契约（二进制单位，B → KiB → MiB → GiB）。
 *
 * 第一性原理：界面中同一「数据大小」概念必须以同一套单位与格式呈现。
 * 此前网络面板把响应体大小分散成三种不一致的写法——表格列除以 1024 却标注
 * 十进制 "KB" 且不向上进位（2.5 MiB 显示成 2560.0 KB）、详情头用裸字节
 * （2621440 B 几乎不可读）、小响应显示成误导性的 "0.0 KB"。同一数值在不同
 * 位置需要用户自行换算，增加认知负担。
 *
 * 契约：
 * - 负值 / NaN / Infinity 一律回退为 "0 B"（防御性兜底）；
 * - < 1024 显示整数字节；
 * - 按 100 阈值切换精度：>= 100 取整、< 100 保留 1 位小数；
 * - 单位依次进位 KiB → MiB → GiB。
 */
test("formatBytes 输出人类可读的二进制单位", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1023), "1023 B");

  assert.equal(formatBytes(1024), "1.0 KiB");
  assert.equal(formatBytes(1536), "1.5 KiB");
  assert.equal(formatBytes(10240), "10.0 KiB");
  assert.equal(formatBytes(102400), "100 KiB");

  assert.equal(formatBytes(1048576), "1.0 MiB");
  assert.equal(formatBytes(2621440), "2.5 MiB");
  assert.equal(formatBytes(104857600), "100 MiB");

  assert.equal(formatBytes(1073741824), "1.0 GiB");
  assert.equal(formatBytes(5 * 1024 * 1024 * 1024), "5.0 GiB");
});

test("formatBytes 对非法输入防御性回退", () => {
  assert.equal(formatBytes(-1), "0 B");
  assert.equal(formatBytes(NaN), "0 B");
  assert.equal(formatBytes(Infinity), "0 B");
});
