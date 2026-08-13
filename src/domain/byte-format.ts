/**
 * 人类可读的字节大小格式化（二进制单位，B → KiB → MiB → GiB）。
 *
 * 第一性原理：界面中同一「数据大小」概念必须以同一套单位与格式呈现。
 * 此前网络面板把响应体大小分散成三种不一致的写法——表格列用
 * `(bytes / 1024).toFixed(1) KB`（除以 1024 却标注十进制 "KB"，且不向上
 * 进位，2.5 MiB 显示成 2560.0 KB）、详情头用裸字节 `2621440 B`（不可读）、
 * 小响应显示成误导性的 "0.0 KB"。同一数值在不同位置需要用户自行换算，
 * 增加认知负担。本函数统一为二进制单位，并按 100 阈值切换精度
 * （>= 100 取整、< 100 保留 1 位小数），保证大数不啰嗦、小数不丢精度。
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  const kib = bytes / 1024;
  if (kib < 1024) return `${trimBytes(kib)} KiB`;

  const mib = kib / 1024;
  if (mib < 1024) return `${trimBytes(mib)} MiB`;

  return `${trimBytes(mib / 1024)} GiB`;
}

function trimBytes(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}
