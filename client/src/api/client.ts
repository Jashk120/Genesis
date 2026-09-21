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

export function putPageBlocks(id: string, tree: DeltaTree): Promise<DeltaTree> {
  return request<DeltaTree>(`/api/pages/${encodeURIComponent(id)}/blocks`, {
    method: "PUT",
    body: JSON.stringify(tree),
  });
}
