import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULT_LOCK_PATH = path.join(
  os.tmpdir(),
  "bug-lens-os-interaction.lock"
);
const DEFAULT_TIMEOUT_MS = 45_000;
const STALE_LOCK_MS = 20_000;
const RETRY_INTERVAL_MS = 25;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let registeredExitHook = false;
const activeLockFiles = new Set<string>();

function ensureExitHook(): void {
  if (registeredExitHook) return;
  registeredExitHook = true;
  const cleanup = () => {
    for (const lockPath of activeLockFiles) {
      try {
        if (fs.existsSync(lockPath)) {
          fs.unlinkSync(lockPath);
        }
      } catch {
        // 退出清理忽略异常
      }
    }
    activeLockFiles.clear();
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
}

/**
 * 跨进程 / 跨 Worker 系统级互斥锁。
 * 保护需要独占操作系统焦点或发送全局按键的临界区（如 AppleScript 击键与前台窗口激活）。
 */
export async function withOsInteractionLock<T>(
  action: () => Promise<T>,
  options?: {
    lockPath?: string;
    timeoutMs?: number;
    label?: string;
  }
): Promise<T> {
  ensureExitHook();
  const lockPath = options?.lockPath ?? DEFAULT_LOCK_PATH;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const label = options?.label ?? "os-interaction";
  const deadline = Date.now() + timeoutMs;
  let fileHandle: fs.promises.FileHandle | undefined;

  while (Date.now() < deadline) {
    try {
      fileHandle = await fs.promises.open(lockPath, "wx");
      const metadata = JSON.stringify({
        pid: process.pid,
        time: Date.now(),
        label,
      });
      await fileHandle.writeFile(metadata);
      activeLockFiles.add(lockPath);
      break;
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "EEXIST") {
        try {
          const stat = await fs.promises.stat(lockPath);
          if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
            try {
              await fs.promises.unlink(lockPath);
            } catch {
              // 竞争删除忽略
            }
          }
        } catch {
          // 文件已被删除，继续重试
        }
        await delay(RETRY_INTERVAL_MS + Math.floor(Math.random() * 20));
        continue;
      }
      throw error;
    }
  }

  if (!fileHandle) {
    throw new Error(
      `OS_LOCK_TIMEOUT: 等待操作系统交互临界区锁超时 (${timeoutMs}ms) [${label}]`
    );
  }

  try {
    return await action();
  } finally {
    activeLockFiles.delete(lockPath);
    try {
      await fileHandle.close();
    } catch {
      // 句柄关闭忽略
    }
    try {
      await fs.promises.unlink(lockPath);
    } catch {
      // 解锁忽略
    }
  }
}
