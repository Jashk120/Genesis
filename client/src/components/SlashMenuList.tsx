import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { SlashCommandItem } from "./SlashCommand";

export interface SlashMenuListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface SlashMenuListProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

export const SlashMenuList = forwardRef<SlashMenuListRef, SlashMenuListProps>(
  function SlashMenuList({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    function select(index: number): void {
      const item = items[index];
      if (item !== undefined) command(item);
    }

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === "ArrowUp") {
          setSelectedIndex((prev) => (prev + items.length - 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((prev) => (prev + 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "Enter") {
          select(selectedIndex);
          return true;
        }
        if (event.key === "Escape") {
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) return null;

    return (
      <div
        data-testid="slash-menu"
        style={{
          minWidth: 240,
          maxWidth: 320,
          background: "#ffffff",
          border: "1px solid #d5dae3",
          borderRadius: 8,
          boxShadow: "0 8px 28px rgba(16, 24, 40, 0.16)",
          padding: 4,
          fontFamily: "sans-serif",
        }}
      >
        {items.map((item, index) => {
          const active = index === selectedIndex;
          return (
            <button
              key={item.title}
              type="button"
              data-testid={`slash-menu-item-${item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              onMouseDown={(e) => {
                e.preventDefault();
                select(index);
              }}
              onMouseEnter={() => setSelectedIndex(index)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 1,
                width: "100%",
                textAlign: "left",
                padding: "7px 10px",
                border: "none",
                borderRadius: 6,
                background: active ? "#e8eefc" : "transparent",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: active ? 600 : 400, color: "#1c2333" }}>
                {item.title}
              </span>
              {item.hint !== undefined && item.hint !== "" && (
                <span style={{ fontSize: 12, color: "#667085" }}>{item.hint}</span>
              )}
            </button>
          );
        })}
      </div>
    );
  },
);
