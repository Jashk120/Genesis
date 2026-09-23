import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
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

const GROUP_ORDER = ["Basic blocks", "Headings", "Lists", "Advanced"];

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
        <svg {...common} className="slash-icon">
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
        <svg {...common} className="slash-icon">
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
        <svg {...common} className="slash-icon">
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
        <svg {...common} className="slash-icon">
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
        <svg {...common} className="slash-icon">
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
        <svg {...common} className="slash-icon">
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
        <svg {...common} className="slash-icon">
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

    const groups = useMemo(() => {
      const byGroup = new Map<string, SlashCommandItem[]>();
      for (const item of items) {
        const list = byGroup.get(item.group);
        if (list === undefined) byGroup.set(item.group, [item]);
        else list.push(item);
      }
      return GROUP_ORDER.filter((g) => byGroup.has(g)).map(
        (g) => [g, byGroup.get(g) ?? []] as const,
      );
    }, [items]);

    const flatIndex = useMemo(() => {
      const map = new Map<SlashCommandItem, number>();
      items.forEach((item, i) => map.set(item, i));
      return map;
    }, [items]);

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
        return false;
      },
    }));

    const clamped = items.length === 0 ? 0 : Math.min(selectedIndex, items.length - 1);

    return (
      <div data-testid="slash-menu" className="slash-menu" role="menu" aria-label="Insert block">
        <div className="slash-filter-row">
          <input
            data-testid="slash-filter"
            aria-label="Filter blocks"
            placeholder="Type to filter…"
            readOnly
            tabIndex={-1}
            value={query}
            className="slash-filter"
            onMouseDown={(e) => e.preventDefault()}
          />
        </div>
        {items.length === 0 && <div className="slash-empty">No matching blocks</div>}
        {groups.map(([group, groupItems]) => (
          <div key={group} className="slash-group">
            <div className="slash-group-label">
              {filtering ? `${group} · filtered` : group}
            </div>
            {groupItems.map((item) => {
              const index = flatIndex.get(item) ?? 0;
              const active = index === clamped;
              return (
                <button
                  key={item.title}
                  type="button"
                  role="menuitem"
                  data-testid={`slash-menu-item-${slug(item.title)}`}
                  data-active={active ? "true" : "false"}
                  className="slash-item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(index);
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <ItemIcon kind={item.icon} />
                  <span className="slash-item-body">
                    <span className="slash-item-title">{item.title}</span>
                    {item.hint !== undefined && item.hint !== "" && (
                      <span className="slash-item-hint">{item.hint}</span>
                    )}
                  </span>
                  {item.shortcut !== undefined && item.shortcut !== "" && (
                    <kbd className="slash-item-shortcut">{item.shortcut}</kbd>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        <div className="slash-footer">
          <span>Close menu</span>
          <kbd className="kbd">esc</kbd>
        </div>
      </div>
    );
  },
);
