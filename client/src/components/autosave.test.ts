import { afterEach, describe, expect, it, vi } from "vitest";
import { DebouncedSaver } from "./autosave";

afterEach(() => {
  vi.useRealTimers();
});

function counterSaver(delayMs: number): { saver: DebouncedSaver; calls: () => number } {
  let calls = 0;
  const saver = new DebouncedSaver(delayMs, () => {
    calls += 1;
    return Promise.resolve();
  });
  return { saver, calls: () => calls };
}

describe("DebouncedSaver", () => {
  it("does not save before the delay, saves once after", async () => {
    vi.useFakeTimers();
    const { saver, calls } = counterSaver(700);
    saver.schedule();
    expect(calls()).toBe(0);
    await vi.advanceTimersByTimeAsync(699);
    expect(calls()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls()).toBe(1);
  });

  it("coalesces rapid schedules into a single save", async () => {
    vi.useFakeTimers();
    const { saver, calls } = counterSaver(700);
    saver.schedule();
    await vi.advanceTimersByTimeAsync(200);
    saver.schedule();
    await vi.advanceTimersByTimeAsync(200);
    saver.schedule();
    await vi.advanceTimersByTimeAsync(700);
    expect(calls()).toBe(1);
    expect(saver.pending).toBe(false);
  });

  it("flush saves immediately without waiting for the delay", async () => {
    vi.useFakeTimers();
    const { saver, calls } = counterSaver(700);
    saver.schedule();
    await saver.flush();
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls()).toBe(1);
  });

  it("flush without a pending edit does not save", async () => {
    vi.useFakeTimers();
    const { saver, calls } = counterSaver(700);
    await saver.flush();
    expect(calls()).toBe(0);
  });

  it("cancel drops the pending save", async () => {
    vi.useFakeTimers();
    const { saver, calls } = counterSaver(700);
    saver.schedule();
    saver.cancel();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls()).toBe(0);
    expect(saver.pending).toBe(false);
  });

  it("serializes overlapping saves so the later edit wins", async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let first = true;
    const saver = new DebouncedSaver(10, () => {
      if (first) {
        first = false;
        order.push("start-1");
        return gate.then(() => {
          order.push("end-1");
        });
      }
      order.push("run-2");
      return Promise.resolve();
    });
    saver.schedule();
    await vi.advanceTimersByTimeAsync(10);
    saver.schedule();
    const done = saver.flush();
    releaseGate();
    await done;
    expect(order).toEqual(["start-1", "end-1", "run-2"]);
  });
});
