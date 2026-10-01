import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_ID } from "./client";
import { watchSpreadsheet } from "./live";

/** Stands in for the browser's EventSource, and lets a test send it events. */
class FakeEventSource {
  static last: FakeEventSource | undefined;
  closed = false;
  private readonly handlers = new Map<string, ((event: MessageEvent<string>) => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }

  addEventListener(type: string, handler: (event: MessageEvent<string>) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }

  emit(type: string, data = ""): void {
    for (const handler of this.handlers.get(type) ?? []) handler(new MessageEvent(type, { data }));
  }

  close(): void {
    this.closed = true;
  }
}

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("watchSpreadsheet", () => {
  it("listens to the spreadsheet's stream under this tab's name, and reports each change", () => {
    const onChange = vi.fn();
    watchSpreadsheet("s1", onChange);
    const source = FakeEventSource.last!;
    // The server leaves the changes made under this name out of the stream.
    expect(source.url).toBe(`/api/spreadsheets/s1/events?client=${CLIENT_ID}`);

    source.emit("ready");
    source.emit("ping");
    expect(onChange).not.toHaveBeenCalled();
    source.emit("change");
    source.emit("change");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("reports once when the connection comes back, for what was missed", () => {
    const onChange = vi.fn();
    watchSpreadsheet("s1", onChange);
    FakeEventSource.last!.emit("ready");
    FakeEventSource.last!.emit("ready");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("stops listening when asked", () => {
    const stop = watchSpreadsheet("s1", vi.fn());
    stop();
    expect(FakeEventSource.last!.closed).toBe(true);
  });

  it("does nothing where there is no EventSource", () => {
    vi.stubGlobal("EventSource", undefined);
    expect(() => {
      watchSpreadsheet("s1", vi.fn())();
    }).not.toThrow();
  });
});
