import { useEffect, useMemo, useRef, useState } from "react";
import { I } from "../icons";
import { t, useLang } from "../i18n";

function loadHiddenWs(): Set<string> {
  try {
    const raw = localStorage.getItem("reasonix.hiddenWorkspaces");
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

type Anchor = { top?: number; bottom?: number; left: number };

export function WorkdirPop({
  open,
  onClose,
  recent,
  openTabDirs,
  current,
  anchor,
  onPick,
  onBrowse,
}: {
  open: boolean;
  onClose: () => void;
  recent: string[];
  openTabDirs?: string[];
  current?: string;
  anchor?: Anchor;
  onPick: (path: string) => void;
  onBrowse: () => void;
}) {
  useLang();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const id = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(id);
  }, [open]);

  const items = useMemo(() => {
    // Merge recent + open-tab dirs so newly opened workspaces appear immediately
    // (before the kernel's $settings round-trip updates recentWorkspaces).
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const combined = [...recent];
    for (const p of openTabDirs ?? []) {
      if (!combined.some((r) => norm(r) === norm(p))) combined.push(p);
    }
    const list = combined.length > 0 ? combined : current ? [current] : [];
    const hidden = loadHiddenWs();
    const seen = new Set<string>();
    const deduped = list.filter((p) => {
      const key = norm(p);
      if (seen.has(key) || hidden.has(key)) return false;
      seen.add(key);
      return true;
    });
    const q = query.trim().toLowerCase();
    if (!q) return deduped;
    return deduped.filter((p) => p.toLowerCase().includes(q));
  }, [recent, openTabDirs, current, query]);

  if (!open) return null;

  const left = anchor?.left ?? 240;
  const positionStyle =
    anchor?.bottom !== undefined
      ? { bottom: anchor.bottom, left }
      : { top: anchor?.top ?? 56, left };

  return (
    <div className="wd-mask" onMouseDown={onClose}>
      <div className="wd-pop" style={positionStyle} onMouseDown={(e) => e.stopPropagation()}>
        <div className="wd-head">
          <I.folder size={12} />
          <span>{t("workdir.title")}</span>
          <span
            style={{
              marginLeft: "auto",
              fontFamily: "inherit",
              fontSize: 10,
              color: "var(--muted)",
            }}
          >
            ⌘O
          </span>
        </div>
        <input
          ref={inputRef}
          className="wd-search"
          placeholder={t("workdir.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (e.key === "Enter" && items[0]) {
              e.preventDefault();
              onPick(items[0]);
              onClose();
            }
          }}
        />
        <div className="wd-list">
          {items.length === 0 ? (
            <div
              style={{
                padding: "16px 12px",
                fontSize: 11.5,
                color: "var(--muted)",
                fontFamily: "inherit",
              }}
            >
              {t("workdir.empty")}
            </div>
          ) : null}
          {items.map((p) => {
            const isCurrent = p === current;
            const name = p.split(/[\\/]/).filter(Boolean).pop() ?? p;
            return (
              <div
                key={p}
                className="wd-row"
                onClick={() => {
                  if (!isCurrent) onPick(p);
                  onClose();
                }}
                title={p}
              >
                <span className="ic">
                  <I.folder size={12} />
                </span>
                <div className="b">
                  <div className="p">{name}</div>
                  <div className="br">{p}</div>
                </div>
                {isCurrent ? (
                  <span className="pin">
                    <I.check size={11} />
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="wd-foot">
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              onBrowse();
              onClose();
            }}
          >
            <I.plus size={11} /> {t("workdir.browse")}
          </button>
        </div>
      </div>
    </div>
  );
}
