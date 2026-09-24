export interface FocusRange {
  from: string;
  to: string;
}

export function docUrl(pageId: string): string {
  return `/doc/${encodeURIComponent(pageId)}`;
}

export function focusUrl(pageId: string, range: FocusRange): string {
  return `/doc/${encodeURIComponent(pageId)}/view?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
}

export function parseAppUrl(
  pathname: string,
  search: string,
): { pageId: string | null; focus: FocusRange | null } {
  const segments = pathname.split("/").filter((s) => s !== "");
  if (segments.length === 0 || segments[0] !== "doc") {
    return { pageId: null, focus: null };
  }
  if (segments.length === 2) {
    try {
      const pageId = decodeURIComponent(segments[1] as string);
      if (pageId === "") {
        return { pageId: null, focus: null };
      }
      return { pageId, focus: null };
    } catch {
      return { pageId: null, focus: null };
    }
  }
  if (segments.length === 3 && segments[2] === "view") {
    let pageId: string;
    try {
      pageId = decodeURIComponent(segments[1] as string);
    } catch {
      return { pageId: null, focus: null };
    }
    if (pageId === "") {
      return { pageId: null, focus: null };
    }
    const params = new URLSearchParams(search);
    const from = params.get("from");
    const to = params.get("to");
    if (from === null || from === "" || to === null || to === "") {
      return { pageId, focus: null };
    }
    return { pageId, focus: { from, to } };
  }
  return { pageId: null, focus: null };
}
