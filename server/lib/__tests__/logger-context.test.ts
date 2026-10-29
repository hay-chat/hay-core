import pino from "pino";
import { Writable } from "node:stream";
import { logContextMixin, withLogContext } from "../logger";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString().trim());
      callback();
    },
  });
  const log = pino({ mixin: logContextMixin }, stream);
  return { log, lines };
}

const occurrences = (text: string, needle: string) => text.split(needle).length - 1;

describe("logger conversation context", () => {
  it("adds the conversation id to lines logged inside withLogContext", async () => {
    const { log, lines } = capture();
    await withLogContext({ conversationId: "conv-1" }, async () => {
      await Promise.resolve();
      log.child({ module: "retrieval" }).info({ topK: 5 }, "Searching vector store");
    });
    log.info("outside");

    expect(JSON.parse(lines[0]).conversationId).toBe("conv-1");
    expect(JSON.parse(lines[1]).conversationId).toBeUndefined();
  });

  it("never duplicates an id the line or its logger already carries", () => {
    const { log, lines } = capture();
    withLogContext({ conversationId: "conv-1" }, () => {
      log.info({ conversationId: "conv-2" }, "explicit");
      log.child({ conversationId: "conv-3" }).info("bound");
    });

    expect(occurrences(lines[0], '"conversationId"')).toBe(1);
    expect(JSON.parse(lines[0]).conversationId).toBe("conv-2");
    expect(occurrences(lines[1], '"conversationId"')).toBe(1);
    expect(JSON.parse(lines[1]).conversationId).toBe("conv-3");
  });
});
