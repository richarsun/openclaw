import { describe, expect, it, vi } from "vitest";
import {
  getPwToolsCoreSessionMocks,
  installPwToolsCoreTestHooks,
  setPwToolsCoreCurrentPage,
} from "./pw-tools-core.test-harness.js";

installPwToolsCoreTestHooks();
const sessionMocks = getPwToolsCoreSessionMocks();
const mod = await import("./pw-tools-core.snapshot.js");

describe("pw-tools-core.snapshot reconnect", () => {
  it("retries AI snapshots after a disconnected-page error with a longer default timeout", async () => {
    const snapshotForAI = vi
      .fn<(...args: unknown[]) => Promise<{ full: string }>>()
      .mockRejectedValueOnce(new Error("Target page, context or browser has been closed"))
      .mockResolvedValueOnce({ full: "Gemini 已生成图片" });
    setPwToolsCoreCurrentPage({
      _snapshotForAI: snapshotForAI,
    });

    const result = await mod.snapshotAiViaPlaywright({
      cdpUrl: "http://127.0.0.1:18792",
      targetId: "T1",
    });

    expect(result.snapshot).toContain("Gemini 已生成图片");
    expect(snapshotForAI).toHaveBeenCalledTimes(2);
    expect(snapshotForAI).toHaveBeenNthCalledWith(1, {
      timeout: 15000,
      track: "response",
    });
    expect(snapshotForAI).toHaveBeenNthCalledWith(2, {
      timeout: 15000,
      track: "response",
    });
    expect(sessionMocks.getPageForTargetId).toHaveBeenCalledTimes(2);
    expect(sessionMocks.forceDisconnectPlaywrightForTarget).toHaveBeenCalledWith({
      cdpUrl: "http://127.0.0.1:18792",
      targetId: "T1",
      reason: "retry snapshot after disconnected page",
    });
  });
});
