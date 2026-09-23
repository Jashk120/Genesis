import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  clusterExportUrl,
  createSnapshot,
  diffSnapshots,
  exportDiffUrl,
  exportPageUrl,
  exportSnapshotUrl,
  getSnapshot,
  historyBundleUrl,
  listSnapshots,
  restoreSnapshot,
  type SnapshotMeta,
  type VersionDiff,
} from "../api/client";
import { historyBundleKind } from "./ExportMenu";
import { hunkHeading, hunkKindLabel, wordEditClassName } from "./DiffView";
import {
  formatBytes,
  formatRowDiff,
  formatSnapshotDate,
  isConflictError,
  snapshotDisplayLabel,
  sortSnapshotsAsc,
  versionTag,
} from "./HistoryPanel";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(ok: boolean, status: number, body: string): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    text: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function meta(overrides: Partial<SnapshotMeta> & { id: string; seq: number }): SnapshotMeta {
  return {
    source_page_id: "page-1",
    label: `label-${overrides.seq}`,
    content_hash: "hash",
    byte_size: 100,
    block_count: 2,
    created_at: "2026-01-02T03:04:05.000Z",
    ...overrides,
  };
}

describe("version list mapping", () => {
  it("tags versions as V-<seq>", () => {
    expect(versionTag(1)).toBe("V-1");
    expect(versionTag(42)).toBe("V-42");
  });

  it("sorts snapshots ascending by seq without mutating the input", () => {
    const input = [meta({ id: "c", seq: 3 }), meta({ id: "a", seq: 1 }), meta({ id: "b", seq: 2 })];
    const sorted = sortSnapshotsAsc(input);
    expect(sorted.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(sorted.map((s) => versionTag(s.seq))).toEqual(["V-1", "V-2", "V-3"]);
    expect(input.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("listSnapshots hits GET /api/pages/:id/snapshots and returns parsed metas", async () => {
    const payload = [meta({ id: "a", seq: 2 }), meta({ id: "b", seq: 1 })];
    const fetchMock = stubFetch(true, 200, JSON.stringify(payload));
    const result = await listSnapshots("page-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/pages/page-1/snapshots");
    expect(result).toEqual(payload);
  });

  it("listSnapshots encodes page ids in the path", async () => {
    const fetchMock = stubFetch(true, 200, "[]");
    await listSnapshots("a/b");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/pages/a%2Fb/snapshots");
  });
});

describe("409 no-change surfacing", () => {
  it("createSnapshot posts {label} and surfaces 409 as a conflict error", async () => {
    const fetchMock = stubFetch(false, 409, "no changes since last snapshot");
    const promise = createSnapshot("page-1", "v2");
    await expect(promise).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/pages/page-1/snapshots");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ label: "v2" }));
    try {
      await createSnapshot("page-1", "v2");
      expect.unreachable("expected createSnapshot to reject");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ApiError);
      expect(isConflictError(err)).toBe(true);
    }
  });

  it("isConflictError is false for other failures", async () => {
    stubFetch(false, 500, "boom");
    try {
      await createSnapshot("page-1", "v2");
      expect.unreachable("expected createSnapshot to reject");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ApiError);
      expect(isConflictError(err)).toBe(false);
    }
    expect(isConflictError(new Error("nope"))).toBe(false);
  });

  it("getSnapshot and restoreSnapshot use the frozen paths", async () => {
    const getMock = stubFetch(true, 200, JSON.stringify({ id: "s-1" }));
    await getSnapshot("s-1");
    expect(getMock.mock.calls[0]?.[0]).toBe("/api/snapshots/s-1");
    const restoreMock = stubFetch(true, 204, "");
    await restoreSnapshot("s-1");
    expect(restoreMock.mock.calls[0]?.[0]).toBe("/api/snapshots/s-1/restore");
    expect((restoreMock.mock.calls[0]?.[1] as RequestInit).method).toBe("POST");
  });
});

describe("diff api", () => {
  it("diffSnapshots builds the exact query string with limit and cursor", async () => {
    const diff: VersionDiff = {
      summary: { added: 1, removed: 0, moved: 0, edited: 0, pages_changed: 1 },
      hunks: [],
      truncated: true,
    };
    const fetchMock = stubFetch(true, 200, JSON.stringify(diff));
    const result = await diffSnapshots("from-1", "to-2", 100, 5);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/snapshots/diff?from=from-1&to=to-2&limit=100&cursor=5",
    );
    expect(result.truncated).toBe(true);
    expect(result.hunks).toEqual([]);
  });

  it("diffSnapshots omits limit/cursor when not given", async () => {
    const fetchMock = stubFetch(
      true,
      200,
      JSON.stringify({
        summary: { added: 0, removed: 0, moved: 0, edited: 0, pages_changed: 0 },
        hunks: [],
        truncated: false,
      }),
    );
    await diffSnapshots("from-1", "to-2");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/snapshots/diff?from=from-1&to=to-2");
  });

  it("formats the row diff summary", () => {
    expect(
      formatRowDiff({ added: 2, removed: 1, moved: 3, edited: 4, pages_changed: 2 }),
    ).toBe("+2/−1/~3/4 edited");
  });
});

describe("export url helpers", () => {
  it("exportPageUrl produces the exact expected query string", () => {
    expect(exportPageUrl("page-1", "md")).toBe("/api/pages/page-1/export?format=md");
    expect(exportPageUrl("page-1", "html")).toBe("/api/pages/page-1/export?format=html");
    expect(exportPageUrl("a/b", "md")).toBe("/api/pages/a%2Fb/export?format=md");
  });

  it("exportSnapshotUrl produces the exact expected query string", () => {
    expect(exportSnapshotUrl("s-1", "md")).toBe("/api/snapshots/s-1/export?format=md");
    expect(exportSnapshotUrl("s-1", "html")).toBe("/api/snapshots/s-1/export?format=html");
  });

  it("exportDiffUrl produces the exact expected query string", () => {
    expect(exportDiffUrl("from-1", "to-2", "md")).toBe(
      "/api/snapshots/diff/export?from=from-1&to=to-2&format=md",
    );
    expect(exportDiffUrl("from-1", "to-2", "html")).toBe(
      "/api/snapshots/diff/export?from=from-1&to=to-2&format=html",
    );
  });

  it("historyBundleUrl omits versions when none are selected", () => {
    expect(historyBundleUrl("page-1", "md")).toBe("/api/pages/page-1/history-bundle?format=md");
    expect(historyBundleUrl("page-1", "html", [])).toBe(
      "/api/pages/page-1/history-bundle?format=html",
    );
  });

  it("historyBundleUrl joins a version multi-select into one versions param", () => {
    expect(historyBundleUrl("page-1", "md", ["v-1", "v-2"])).toBe(
      "/api/pages/page-1/history-bundle?format=md&versions=v-1%2Cv-2",
    );
  });

  it("clusterExportUrl produces the exact expected query string", () => {
    expect(clusterExportUrl("page-1", "md")).toBe("/api/pages/page-1/cluster-export?format=md");
    expect(clusterExportUrl("page-1", "html")).toBe(
      "/api/pages/page-1/cluster-export?format=html",
    );
  });

  it("marks bundles with >=10 versions as zip archives", () => {
    expect(historyBundleKind(0, 3)).toBe("single file");
    expect(historyBundleKind(3, 12)).toBe("single file");
    expect(historyBundleKind(9, 12)).toBe("single file");
    expect(historyBundleKind(10, 12)).toBe("zip archive");
    expect(historyBundleKind(0, 10)).toBe("zip archive");
  });
});

describe("diff word-edit rendering decisions", () => {
  it("maps word edit kinds to classes", () => {
    expect(wordEditClassName("eq")).toBe("diff-eq");
    expect(wordEditClassName("del")).toBe("diff-del");
    expect(wordEditClassName("ins")).toBe("diff-ins");
  });

  it("labels hunk kinds", () => {
    expect(hunkKindLabel("added")).toBe("Added");
    expect(hunkKindLabel("removed")).toBe("Removed");
    expect(hunkKindLabel("moved")).toBe("Moved");
    expect(hunkKindLabel("edited")).toBe("Edited");
    expect(hunkKindLabel("page_title")).toBe("Renamed pages");
  });

  it("derives hunk headings from paths with block fallbacks", () => {
    expect(
      hunkHeading({
        block_id: "b-1",
        page_id: "p-1",
        kind: "edited",
        path: ["Chapter 1", "Scene 2"],
        before_text: null,
        after_text: null,
        word_edits: [],
        moved_from: null,
      }),
    ).toBe("Chapter 1 / Scene 2");
    expect(
      hunkHeading({
        block_id: "b-9",
        page_id: "p-1",
        kind: "added",
        path: [],
        before_text: null,
        after_text: "new",
        word_edits: [],
        moved_from: null,
      }),
    ).toBe("b-9");
  });
});

describe("malformed input robustness", () => {
  it("falls back for empty or missing snapshot labels", () => {
    expect(snapshotDisplayLabel(meta({ id: "a", seq: 1, label: "  " }))).toBe("(untitled version)");
    const missing = meta({ id: "a", seq: 1 }) as unknown as Record<string, unknown>;
    delete missing["label"];
    expect(snapshotDisplayLabel(missing as unknown as SnapshotMeta)).toBe("(untitled version)");
    expect(snapshotDisplayLabel(meta({ id: "a", seq: 1, label: " Draft " }))).toBe("Draft");
  });

  it("handles missing optional snapshot fields", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatSnapshotDate(null)).toBe("unknown date");
    expect(formatSnapshotDate("")).toBe("unknown date");
    expect(formatSnapshotDate("not-a-date")).toBe("unknown date");
    expect(formatSnapshotDate("2026-01-02T03:04:05.000Z")).not.toBe("unknown date");
  });

  it("represents a zero-hunk diff without crashing", () => {
    const empty: VersionDiff = {
      summary: { added: 0, removed: 0, moved: 0, edited: 0, pages_changed: 0 },
      hunks: [],
      truncated: false,
    };
    expect(empty.hunks.length).toBe(0);
    expect(formatRowDiff(empty.summary)).toBe("+0/−0/~0/0 edited");
  });

  it("accepts a truncated diff payload shaped for cursor pagination", async () => {
    const first: VersionDiff = {
      summary: { added: 5, removed: 0, moved: 0, edited: 0, pages_changed: 1 },
      hunks: [],
      truncated: true,
    };
    const fetchMock = stubFetch(true, 200, JSON.stringify(first));
    const result = await diffSnapshots("from-1", "to-2", 100);
    expect(result.truncated).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/snapshots/diff?from=from-1&to=to-2&limit=100");
  });
});
