import { describe, expect, it } from "vitest";
import { threadId } from "./agents";

describe("threadId", () => {
  it("is a:{agentId}:p:{projectId}, one thread per agent × project", () => {
    expect(threadId("pip", "dm-01JA")).toBe("a:pip:p:dm-01JA");
  });
});
