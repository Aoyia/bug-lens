import assert from "node:assert/strict";
import test, { afterEach, beforeEach, describe } from "node:test";
import { createTestRuntime } from "./helpers/background-runtime-harness.ts";
import { installChromeMock } from "./helpers/chrome-mock.ts";
import { message } from "../src/shared/protocol.ts";
import {
  createHostPlatformResolver,
  detectClientIsMac,
} from "../src/entrypoints/content/interaction-collector.ts";

function sender(tabId = 1) {
  return {
    tab: { id: tabId },
    frameId: 0,
  } as chrome.runtime.MessageSender;
}

describe("宿主平台识别 (runtime/host-platform 与 content 降级)", () => {
  let originalChrome: unknown;
  let originalNavigatorDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalChrome = (globalThis as { chrome?: unknown }).chrome;
    originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "navigator"
    );
  });

  afterEach(() => {
    if (originalChrome === undefined) {
      delete (globalThis as { chrome?: unknown }).chrome;
    } else {
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
    if (originalNavigatorDescriptor) {
      Object.defineProperty(
        globalThis,
        "navigator",
        originalNavigatorDescriptor
      );
    } else {
      delete (globalThis as { navigator?: unknown }).navigator;
    }
  });

  test("background runtime/host-platform: os 为 mac 时返回 isMac: true", async () => {
    const { chrome } = installChromeMock();
    (
      chrome.runtime as unknown as {
        getPlatformInfo?: () => Promise<{ os: string; arch: string }>;
      }
    ).getPlatformInfo = async () => ({ os: "mac", arch: "arm64" });

    const { runtime } = createTestRuntime();
    const res = (await runtime.handleMessage(
      message("runtime/host-platform", {}),
      sender(42)
    )) as { ok: boolean; os: string; isMac: boolean | null };

    assert.equal(res.ok, true);
    assert.equal(res.os, "mac");
    assert.equal(res.isMac, true);
  });

  test("background runtime/host-platform: os 为 win 时返回 isMac: false", async () => {
    const { chrome } = installChromeMock();
    (
      chrome.runtime as unknown as {
        getPlatformInfo?: () => Promise<{ os: string; arch: string }>;
      }
    ).getPlatformInfo = async () => ({ os: "win", arch: "x86-64" });

    const { runtime } = createTestRuntime();
    const res = (await runtime.handleMessage(
      message("runtime/host-platform", {}),
      sender(42)
    )) as { ok: boolean; os: string; isMac: boolean | null };

    assert.equal(res.ok, true);
    assert.equal(res.os, "win");
    assert.equal(res.isMac, false);
  });

  test("background runtime/host-platform: getPlatformInfo 抛异常时降级返回 unknown / null", async () => {
    const { chrome } = installChromeMock();
    (
      chrome.runtime as unknown as {
        getPlatformInfo?: () => Promise<{ os: string }>;
      }
    ).getPlatformInfo = async () => {
      throw new Error("platform api unavailable");
    };

    const { runtime } = createTestRuntime();
    const res = (await runtime.handleMessage(
      message("runtime/host-platform", {}),
      sender(42)
    )) as { ok: boolean; os: string; isMac: boolean | null };

    assert.equal(res.ok, true);
    assert.equal(res.os, "unknown");
    assert.equal(res.isMac, null);
  });

  test("background runtime/host-platform: 无 getPlatformInfo API 时降级返回 unknown / null", async () => {
    const { chrome } = installChromeMock();
    delete (chrome.runtime as unknown as { getPlatformInfo?: unknown })
      .getPlatformInfo;

    const { runtime } = createTestRuntime();
    const res = (await runtime.handleMessage(
      message("runtime/host-platform", {}),
      sender(42)
    )) as { ok: boolean; os: string; isMac: boolean | null };

    assert.equal(res.ok, true);
    assert.equal(res.os, "unknown");
    assert.equal(res.isMac, null);
  });

  test("content detectClientIsMac 同步回退识别 navigator.platform 与模拟 Android UA", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { platform: "MacIntel", userAgent: "Mozilla/5.0" },
      configurable: true,
    });
    assert.equal(detectClientIsMac(), true);

    Object.defineProperty(globalThis, "navigator", {
      value: {
        platform: "Linux armv81",
        userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7)",
      },
      configurable: true,
    });
    assert.equal(detectClientIsMac(), false);
  });

  test("content createHostPlatformResolver 仅查询一次并缓存真实宿主结果", async () => {
    let callCount = 0;
    const sentTypes: string[] = [];
    const resolver = createHostPlatformResolver(async (msg) => {
      callCount += 1;
      sentTypes.push((msg as { type: string }).type);
      return { ok: true, os: "mac", isMac: true };
    });

    const [first, second] = await Promise.all([
      resolver.resolveOnce(),
      resolver.resolveOnce(),
    ]);
    const third = await resolver.resolveOnce();

    assert.equal(first, true);
    assert.equal(second, true);
    assert.equal(third, true);
    assert.equal(resolver.getCached(), true);
    assert.equal(callCount, 1);
    assert.deepEqual(sentTypes, ["runtime/host-platform"]);
  });

  test("content createHostPlatformResolver 在无 sendMessage 或返回 null/异常时保持回退", async () => {
    delete (globalThis as { chrome?: unknown }).chrome;
    const noSenderResolver = createHostPlatformResolver();
    assert.equal(await noSenderResolver.resolveOnce(), undefined);
    assert.equal(noSenderResolver.getCached(), undefined);

    let nullCalls = 0;
    const nullResolver = createHostPlatformResolver(async () => {
      nullCalls += 1;
      return { ok: true, os: "unknown", isMac: null };
    });
    assert.equal(await nullResolver.resolveOnce(), undefined);
    assert.equal(await nullResolver.resolveOnce(), undefined);
    assert.equal(nullResolver.getCached(), undefined);
    assert.equal(nullCalls, 1);

    const errResolver = createHostPlatformResolver(async () => {
      throw new Error("disconnected");
    });
    assert.equal(await errResolver.resolveOnce(), undefined);
    assert.equal(errResolver.getCached(), undefined);
  });
});
