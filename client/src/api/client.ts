/**
 * Typed fetch wrappers for the Genesis backend API.
 *
 * Backend routes (owned by another agent; Rust server on :8080):
 *   GET    /api/health
 *   GET    /api/workspaces   · POST /api/workspaces
 *   GET    /api/pages?workspace_id=&parent_id=
 *   POST   /api/pages
 *   PATCH  /api/pages/:id
 *   DELETE /api/pages/:id
 *   GET    /api/pages/:id/blocks
 *   PUT    /api/pages/:id/blocks
 *
 * Non-2xx responses throw `ApiError`.
 */
import type { DeltaTree } from "../mapper";

export class ApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string, path: string) {
    super(`api: ${path} failed with ${status}: ${body}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export interface Workspace {
  id: string;
  title: string;
  created_at?: string;
}

export interface Page {
  id: string;
  workspace_id: string;
  parent_page_id: string | null;
  kind: string;
  title: string;
  ordinal?: number;
}

export interface CreatePageInput {
  workspace_id: string;
  parent_page_id?: string | null;
  kind?: string;
  title: string;
}

export interface UpdatePageInput {
  title?: string;
  parent_page_id?: string | null;
  ordinal?: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body, path);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (text === "") return undefined as T;
  return JSON.parse(text) as T;
}

function query(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, v);
  }
  const s = qs.toString();
  return s === "" ? "" : `?${s}`;
}

export function getHealth(): Promise<{ status: string }> {
  return request<{ status: string }>("/api/health");
}

export function listWorkspaces(): Promise<Workspace[]> {
  return request<Workspace[]>("/api/workspaces");
}

export function createWorkspace(title: string): Promise<Workspace> {
  return request<Workspace>("/api/workspaces", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function listPages(workspaceId: string, parentId?: string): Promise<Page[]> {
  return request<Page[]>(
    `/api/pages${query({ workspace_id: workspaceId, parent_id: parentId })}`,
  );
}

export function createPage(input: CreatePageInput): Promise<Page> {
  return request<Page>("/api/pages", {
    method: "POST",
    body: JSON.stringify({ kind: "chapter", ...input }),
  });
}

export function updatePage(id: string, input: UpdatePageInput): Promise<Page> {
  return request<Page>(`/api/pages/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deletePage(id: string): Promise<void> {
  return request<void>(`/api/pages/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function getPageBlocks(id: string): Promise<DeltaTree> {
  return request<DeltaTree>(`/api/pages/${encodeURIComponent(id)}/blocks`);
}

export function getPage(id: string): Promise<Page> {
  return request<Page>(`/api/pages/${encodeURIComponent(id)}`);
}

export function putPageBlocks(id: string, tree: DeltaTree): Promise<DeltaTree> {
  return request<DeltaTree>(`/api/pages/${encodeURIComponent(id)}/blocks`, {
    method: "PUT",
    body: JSON.stringify(tree),
  });
}

/**
 * Version history, diff viewing, restore, and export.
 *
 * Backend routes (frozen contract, owned by another agent):
 *   GET    /api/pages/:id/snapshots
 *   POST   /api/pages/:id/snapshots            {label}; 409 on dup/no-change
 *   GET    /api/snapshots/:id
 *   POST   /api/snapshots/:id/restore
 *   GET    /api/snapshots/diff?from=&to=&limit=&cursor=
 *   GET    /api/pages/:id/export?format=                    (download URL)
 *   GET    /api/snapshots/:id/export?format=                (download URL)
 *   GET    /api/snapshots/diff/export?from=&to=&format=     (download URL)
 *   GET    /api/pages/:id/history-bundle?format=&versions=  (download URL)
 *   GET    /api/pages/:id/cluster-export?format=            (download URL)
 *
 * The `*Url` helpers return a plain URL string only; the caller performs the
 * download via an `<a href>` / `window.location` assignment and MUST NOT
 * fetch or assemble export bytes in JS.
 */

export interface SnapshotMeta {
  id: string;
  source_page_id: string;
  label: string;
  seq: number;
  content_hash: string;
  byte_size: number | null;
  block_count: number | null;
  created_at: string;
}

export interface Snapshot extends SnapshotMeta {
  workspace_id: string;
  content: SnapshotEnvelope;
  scope_page_ids: string[];
  base_snapshot_id: string | null;
  delta: unknown;
  is_materialized: boolean;
}

export interface SnapshotPageMeta {
  id: string;
  kind: string;
  title: string;
  parent_page_id: string | null;
  ordinal: number;
  narrative_order: number | null;
}

export interface SnapshotEnvelope {
  version: number;
  root_page_id: string;
  pages: SnapshotPageMeta[];
  trees: Record<string, unknown>;
}

export type HunkKind = "added" | "removed" | "moved" | "edited" | "page_title";
export type WordEditKind = "eq" | "del" | "ins";

export interface WordEdit {
  kind: WordEditKind;
  text: string;
}

export interface Hunk {
  block_id: string;
  page_id: string;
  kind: HunkKind;
  path: string[];
  before_text: string | null;
  after_text: string | null;
  word_edits: WordEdit[];
  moved_from: { page_id: string; block_id: string; path: string[] } | null;
}

export interface DiffSummary {
  added: number;
  removed: number;
  moved: number;
  edited: number;
  pages_changed: number;
}

export interface VersionDiff {
  summary: DiffSummary;
  hunks: Hunk[];
  truncated: boolean;
}

export type ExportFormat = "md" | "html";

export function listSnapshots(pageId: string): Promise<SnapshotMeta[]> {
  return request<SnapshotMeta[]>(`/api/pages/${encodeURIComponent(pageId)}/snapshots`);
}

export function createSnapshot(pageId: string, label: string): Promise<SnapshotMeta> {
  return request<SnapshotMeta>(`/api/pages/${encodeURIComponent(pageId)}/snapshots`, {
    method: "POST",
    body: JSON.stringify({ label }),
  });
}

export function getSnapshot(id: string): Promise<Snapshot> {
  return request<Snapshot>(`/api/snapshots/${encodeURIComponent(id)}`);
}

export function restoreSnapshot(id: string): Promise<void> {
  return request<void>(`/api/snapshots/${encodeURIComponent(id)}/restore`, {
    method: "POST",
  });
}

export function diffSnapshots(
  from: string,
  to: string,
  limit?: number,
  cursor?: number,
): Promise<VersionDiff> {
  return request<VersionDiff>(
    `/api/snapshots/diff${query({
      from,
      to,
      limit: limit === undefined ? undefined : String(limit),
      cursor: cursor === undefined ? undefined : String(cursor),
    })}`,
  );
}

export function exportPageUrl(pageId: string, format: ExportFormat): string {
  return `/api/pages/${encodeURIComponent(pageId)}/export${query({ format })}`;
}

export function exportSnapshotUrl(id: string, format: ExportFormat): string {
  return `/api/snapshots/${encodeURIComponent(id)}/export${query({ format })}`;
}

export function exportDiffUrl(from: string, to: string, format: ExportFormat): string {
  return `/api/snapshots/diff/export${query({ from, to, format })}`;
}

export function historyBundleUrl(
  pageId: string,
  format: ExportFormat,
  versions?: string[],
): string {
  return `/api/pages/${encodeURIComponent(pageId)}/history-bundle${query({
    format,
    versions:
      versions === undefined || versions.length === 0 ? undefined : versions.join(","),
  })}`;
}

export function clusterExportUrl(pageId: string, format: ExportFormat): string {
  return `/api/pages/${encodeURIComponent(pageId)}/cluster-export${query({ format })}`;
}
