import type { Page } from "../api";

interface PageTreeProps {
  pages: Page[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function PageTree({ pages, selectedId, onSelect }: PageTreeProps) {
  const roots = pages.filter(
    (p) => p.parent_page_id === null || p.parent_page_id === undefined,
  );
  if (pages.length === 0) return <p style={{ color: "#666" }}>No pages yet.</p>;
  return (
    <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
      {roots.map((p) => (
        <TreeNode
          key={p.id}
          page={p}
          pages={pages}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={0}
        />
      ))}
    </ul>
  );
}

function TreeNode({
  page,
  pages,
  selectedId,
  onSelect,
  depth,
}: {
  page: Page;
  pages: Page[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth: number;
}) {
  const children = pages.filter((p) => p.parent_page_id === page.id);
  const active = page.id === selectedId;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(page.id)}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          padding: "4px 8px",
          paddingLeft: 8 + depth * 16,
          border: "none",
          background: active ? "#e8eefc" : "transparent",
          cursor: "pointer",
          fontWeight: active ? 600 : 400,
        }}
      >
        {page.title || "(untitled)"}
        <span style={{ color: "#999", fontSize: 11 }}> · {page.kind}</span>
      </button>
      {children.length > 0 && (
        <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
          {children.map((c) => (
            <TreeNode
              key={c.id}
              page={c}
              pages={pages}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
