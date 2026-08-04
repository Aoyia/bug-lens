import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  captureEnvironment,
  describeOsFromUserAgent,
  describeBrowserFromUserAgent,
  formatEnvironmentSummary,
} from "../src/domain/environment-capture.ts";

describe("Environment Capture", () => {
  let originalWindow: any;
  let originalDocument: any;
  let mockWindow: any;
  let mockDocument: any;

  beforeEach(() => {
    originalWindow = (globalThis as any).window;
    originalDocument = (globalThis as any).document;

    mockDocument = { title: "Test" };
    mockWindow = {
      top: null,
      innerWidth: 1440,
      innerHeight: 900,
      devicePixelRatio: 2,
      screen: { width: 2880, height: 1800 },
      navigator: {
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        platform: "MacIntel",
        language: "zh-CN",
        onLine: true,
      },
    };
    mockWindow.top = mockWindow;

    (globalThis as any).window = mockWindow;
    (globalThis as any).document = mockDocument;
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
  });

  test("captures full environment snapshot from the main frame", () => {
    const env = captureEnvironment();
    assert.ok(env);
    assert.equal(env!.screenWidth, 2880);
    assert.equal(env!.screenHeight, 1800);
    assert.equal(env!.viewportWidth, 1440);
    assert.equal(env!.viewportHeight, 900);
    assert.equal(env!.devicePixelRatio, 2);
    assert.equal(env!.language, "zh-CN");
    assert.equal(env!.online, true);
    assert.ok(env!.capturedAtEpochMs > 0);
  });

  test("returns undefined inside an iframe (non-top frame)", () => {
    mockWindow.top = {};
    assert.equal(captureEnvironment(), undefined);
  });

  test("returns undefined when window/screen is unavailable", () => {
    (globalThis as any).window = undefined;
    (globalThis as any).document = undefined;
    assert.equal(captureEnvironment(), undefined);
  });

  test("parses OS and browser from user agent", () => {
    const macUa =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    assert.equal(describeOsFromUserAgent(macUa), "macOS 10.15.7");
    assert.equal(describeBrowserFromUserAgent(macUa), "Chrome 126");

    const winUa =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0";
    assert.equal(describeOsFromUserAgent(winUa), "Windows 10/11");
    assert.equal(describeBrowserFromUserAgent(winUa), "Edge 125");

    const firefoxUa =
      "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";
    assert.equal(describeOsFromUserAgent(firefoxUa), "Linux");
    assert.equal(describeBrowserFromUserAgent(firefoxUa), "Firefox 127");
  });

  test("formatEnvironmentSummary renders a human-readable one-liner", () => {
    const env = captureEnvironment()!;
    const summary = formatEnvironmentSummary(env);
    assert.match(summary, /macOS/);
    assert.match(summary, /Chrome 126/);
    assert.match(summary, /2880×1800@2x/);
    assert.match(summary, /1440×900/);
    assert.equal(formatEnvironmentSummary(undefined), "");
  });
});
