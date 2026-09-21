import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { SlashCommandItem, SlashIconKind } from "./SlashCommand";

export interface SlashMenuListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface SlashMenuListProps {
  items: SlashCommandItem[];
  query: string;
  command: (item: SlashCommandItem) => void;
}

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function ItemIcon({ kind }: { kind: SlashIconKind | undefined }) {
  const common = {
    width: 28,
    height: 28,
    viewBox: "0 0 28 28",
    fill: "none",
    "aria-hidden": true,
  } as const;
  switch (kind) {
    case "page":
      return (
        <svg {...common} style={{ flexShrink: 0 }}>
          <rect x="2" y="2" width="24" height="24" rx="5" stroke="#5a5a5a" strokeWidth="1.4" />
          <path
            d="M10 6.5h5l3 3v8.5h-8v-11.5Z"
            stroke="#d4d4d4"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path d="M15 6.5v3h3" stroke="#d4d4d4" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      );
    case "h1":
    case "h2":
    case "h3":
    case "h4": {
      const label = kind.toUpperCase();
      return (
        <svg {...common} style={{ flexShrink: 0 }}>
          <rect x="2" y="2" width="24" height="24" rx="5" stroke="#5a5a5a" strokeWidth="1.4" />
          <text
            x="14"
            y="18.5"
            textAnchor="middle"
            fill="#d4d4d4"
            fontSize="11"
            fontWeight="700"
            fontFamily="Georgia, 'Times New Roman', serif"
          >
            {label}
          </text>
        </svg>
      );
    }
    case "bullet":
      return (
        <svg {...common} style={{ flexShrink: 0 }}>
          <rect x="2" y="2" width="24" height="24" rx="5" stroke="#5a5a5a" strokeWidth="1.4" />
          <circle cx="10" cy="10" r="1.4" fill="#d4d4d4" />
          <circle cx="10" cy="14" r="1.4" fill="#d4d4d4" />
          <circle cx="10" cy="18" r="1.4" fill="#d4d4d4" />
          <path
            d="M13.5 10h5M13.5 14h5M13.5 18h5"
            stroke="#d4d4d4"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      );
    case "numbered":
      return (
        <svg {...common} style={{ flexShrink: 0 }}>
          <rect x="2" y="2" width="24" height="24" rx="5" stroke="#5a5a5a" strokeWidth="1.4" />
          <text x="8" y="13" textAnchor="middle" fill="#d4d4d4" fontSize="7" fontWeight="700">
            1
          </text>
          <text x="8" y="20" textAnchor="middle" fill="#d4d4d4" fontSize="7" fontWeight="700">
            2
          </text>
          <path d="M12.5 10h6M12.5 17h6" stroke="#d4d4d4" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "quote":
      return (
        <svg {...common} style={{ flexShrink: 0 }}>
          <rect x="2" y="2" width="24" height="24" rx="5" stroke="#5a5a5a" strokeWidth="1.4" />
          <path
            d="M11 9.5c-1.8.6-2.8 1.9-2.8 3.9v1.1h3v-3h-1.7c.2-1 .8-1.6 1.9-2l-.4-1Z"
            fill="#d4d4d4"
          />
          <path
            d="M17.5 9.5c-1.8.6-2.8 1.9-2.8 3.9v1.1h3v-3h-1.7c.2-1 .8-1.6 1.9-2l-.4-1Z"
            fill="#d4d4d4"
          />
        </svg>
      );
    case "code":
      return (
        <svg {...common} style={{ flexShrink: 0 }}>
          <rect x="2" y="2" width="24" height="24" rx="5" stroke="#5a5a5a" strokeWidth="1.4" />
          <path
            d="m11 10-3 4 3 4M17 10l3 4-3 4"
            stroke="#d4d4d4"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "text":
    default:
      return (
        <svg {...common} style={{ flexShrink: 0 }}>
          <rect x="2" y="2" width="24" height="24" rx="5" stroke="#5a5a5a" strokeWidth="1.4" />
          <path
            d="M10 8.5h8M14 8.5v11"
            stroke="#d4d4d4"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}

export const SlashMenuList = forwardRef<SlashMenuListRef, SlashMenuListProps>(
  function SlashMenuList({ items, query, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    const filtering = query.trim() !== "";
    const header = filtering ? "Filled results" : "Basic blocks";

    function select(index: number): void {
      const item = items[index];
      if (item !== undefined) command(item);
    }

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSelectedIndex((prev) => (prev + items.length - 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "Enter") {
          if (items.length === 0) return false;
          event.preventDefault();
          select(selectedIndex);
          return true;
        }
        // Let Escape fall through so the suggestion plugin closes the menu.
        return false;
      },
    }));

    const clamped = items.length === 0 ? 0 : Math.min(selectedIndex, items.length - 1);

    return (
      <div
        data-testid="slash-menu"
        className="slash-menu"
        role="menu"
        style={{
          width: 320,
          maxHeight: 380,
          overflowY: "auto",
          background: "#202020",
          border: "1px solid #3a3a3a",
          borderRadius: 10,
          boxShadow: "0 12px 40px rgba(0, 0, 0, 0.55)",
          padding: 6,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          color: "#d4d4d4",
        }}
      >
        <div style={{ padding: "2px 2px 6px" }}>
          <input
            data-testid="slash-filter"
            aria-label="Filter blocks"
            placeholder="Type to filter…"
            readOnly
            tabIndex={-1}
            value={query}
            onMouseDown={(e) => e.preventDefault()}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "#2a2a2a",
              border: "1px solid #3d3d3d",
              borderRadius: 6,
              color: "#d4d4d4",
              fontSize: 13,
              padding: "7px 10px",
              outline: "none",
            }}
          />
        </div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "#8a8a8a",
            padding: "4px 10px 6px",
          }}
        >
          {header}
        </div>
        {items.length === 0 && (
          <div style={{ fontSize: 13, color: "#8a8a8a", padding: "8px 10px" }}>No results</div>
        )}
        {items.map((item, index) => {
          const active = index === clamped;
          return (
            <button
              key={item.title}
              type="button"
              role="menuitem"
              data-testid={`slash-menu-item-${slug(item.title)}`}
              onMouseDown={(e) => {
                e.preventDefault();
                select(index);
              }}
              onMouseEnter={() => setSelectedIndex(index)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                textAlign: "left",
                padding: "7px 8px",
                border: "none",
                borderRadius: 6,
                background: active ? "#333333" : "transparent",
                cursor: "pointer",
                color: "inherit",
              }}
            >
              <ItemIcon kind={item.icon} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, color: "#e6e6e6" }}>
                  {item.title}
                </span>
                {item.hint !== undefined && item.hint !== "" && (
                  <span style={{ display: "block", fontSize: 12, color: "#8a8a8a" }}>
                    {item.hint}
                  </span>
                )}
              </span>
              {item.shortcut !== undefined && item.shortcut !== "" && (
                <kbd
                  style={{
                    flexShrink: 0,
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 12,
                    color: "#8a8a8a",
                    background: "#2a2a2a",
                    border: "1px solid #3d3d3d",
                    borderRadius: 4,
                    padding: "1px 6px",
                  }}
                >
                  {item.shortcut}
                </kbd>
              )}
            </button>
          );
        })}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid #333333",
            marginTop: 6,
            padding: "8px 10px 2px",
            fontSize: 12,
            color: "#8a8a8a",
          }}
        >
          <span>Close menu</span>
          <kbd
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 11,
              background: "#2a2a2a",
              border: "1px solid #3d3d3d",
              borderRadius: 4,
              padding: "1px 6px",
            }}
          >
            esc
          </kbd>
        </div>
      </div>
    );
  },
);
