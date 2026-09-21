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
  if (pages.length === 0) return <p style={{ color: "#9b9b9b" }}>No pages yet.</p>;
  return (
    <ul className="page-tree">
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
        data-active={active ? "true" : "false"}
        onClick={() => onSelect(page.id)}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        {page.title || "(untitled)"}
        <span style={{ color: "#6f6f6f", fontSize: 11 }}> · {page.kind}</span>
      </button>
      {children.length > 0 && (
        <ul className="page-tree">
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
