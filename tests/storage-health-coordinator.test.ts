import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateOffscreenStorageWrite,
  validateStorageHealthUpdate,
} from "../src/storage/storage-health-coordinator.ts";

test("evaluateOffscreenStorageWrite 规则验证", () => {
  // 正常未超额写入，不产生通知消息
  const normalWrite = evaluateOffscreenStorageWrite(
    "sess-1",
    { stored: true, usedBytes: 100, limitReached: false },
    false
  );
  assert.equal(normalWrite.shouldNotify, false);
  assert.equal(normalWrite.message, undefined);

  // 连续超额写入（已通知过），再次写入不再重复发送
  const repeatLimit = evaluateOffscreenStorageWrite(
    "sess-1",
    { stored: true, usedBytes: 950, limitReached: true },
    true
  );
  assert.equal(repeatLimit.shouldNotify, false);

  // 首次触发 >=90% 配额警告，触发 offscreen/storage-state 通知
  const newlyLimit = evaluateOffscreenStorageWrite(
    "sess-1",
    { stored: true, usedBytes: 900, limitReached: true },
    false
  );
  assert.equal(newlyLimit.shouldNotify, true);
  assert.equal(newlyLimit.message?.type, "offscreen/storage-state");
  assert.equal(newlyLimit.message?.payload.limitReached, true);
  assert.equal(newlyLimit.message?.payload.stored, true);

  // 写入拒绝 (!stored)，即使已经处于 limitReached 也强制触发通知
  const rejected = evaluateOffscreenStorageWrite(
    "sess-1",
    { stored: false, usedBytes: 1000, limitReached: true },
    true
  );
  assert.equal(rejected.shouldNotify, true);
  assert.equal(rejected.message?.payload.stored, false);
});

test("Offscreen 存储状态转换与防护断言序列 (89% -> 90% -> 95% -> 100%)", () => {
  let storageWarningSent = false;
  let recordingBlocked = false;

  const simulateChunkWrite = (result: {
    stored: boolean;
    usedBytes: number;
    limitReached: boolean;
  }) => {
    if (recordingBlocked) return { saved: false, notified: false };
    const decision = evaluateOffscreenStorageWrite(
      "sess-seq",
      result,
      storageWarningSent
    );
    if (result.stored && result.limitReached) {
      storageWarningSent = true;
    }
    if (!result.stored) {
      recordingBlocked = true;
    }
    return { saved: result.stored, notified: decision.shouldNotify };
  };

  // 1. 89% 正常写入：未超额，未通知
  const step1 = simulateChunkWrite({
    stored: true,
    usedBytes: 890,
    limitReached: false,
  });
  assert.equal(step1.saved, true);
  assert.equal(step1.notified, false);
  assert.equal(storageWarningSent, false);
  assert.equal(recordingBlocked, false);

  // 2. 首次 90% 警告：正常写入，触发通知，警告置为 true，允许后续写入
  const step2 = simulateChunkWrite({
    stored: true,
    usedBytes: 900,
    limitReached: true,
  });
  assert.equal(step2.saved, true);
  assert.equal(step2.notified, true);
  assert.equal(storageWarningSent, true);
  assert.equal(recordingBlocked, false);

  // 3. 95% 持续超额写入：正常写入，不重复通知，允许后续写入
  const step3 = simulateChunkWrite({
    stored: true,
    usedBytes: 950,
    limitReached: true,
  });
  assert.equal(step3.saved, true);
  assert.equal(step3.notified, false);
  assert.equal(storageWarningSent, true);
  assert.equal(recordingBlocked, false);

  // 4. 100% 写入被拒绝：写入失败，触发拒绝通知，recordingBlocked 置为 true
  const step4 = simulateChunkWrite({
    stored: false,
    usedBytes: 1000,
    limitReached: true,
  });
  assert.equal(step4.saved, false);
  assert.equal(step4.notified, true);
  assert.equal(recordingBlocked, true);

  // 5. 后续分片由于 recordingBlocked 被硬拦截，直接丢弃
  const step5 = simulateChunkWrite({
    stored: true,
    usedBytes: 1000,
    limitReached: true,
  });
  assert.equal(step5.saved, false);
  assert.equal(step5.notified, false);
});

test("validateStorageHealthUpdate 卡口校验", () => {
  const offscreenUrl = "chrome-extension://abc/offscreen.html";

  // 当前 active session 且来自 offscreen.html
  const valid = validateStorageHealthUpdate({
    senderUrl: offscreenUrl,
    expectedOffscreenUrl: offscreenUrl,
    incomingSessionId: "sess-active",
    currentActiveSessionId: "sess-active",
  });
  assert.equal(valid, true);

  // 旧 Session 迟到消息，判定无效
  const oldSession = validateStorageHealthUpdate({
    senderUrl: offscreenUrl,
    expectedOffscreenUrl: offscreenUrl,
    incomingSessionId: "sess-old",
    currentActiveSessionId: "sess-active",
  });
  assert.equal(oldSession, false);

  // 伪造 sender url（普通网页/Content Script），判定无效
  const forgedSender = validateStorageHealthUpdate({
    senderUrl: "https://evil.com",
    expectedOffscreenUrl: offscreenUrl,
    incomingSessionId: "sess-active",
    currentActiveSessionId: "sess-active",
  });
  assert.equal(forgedSender, false);
});
