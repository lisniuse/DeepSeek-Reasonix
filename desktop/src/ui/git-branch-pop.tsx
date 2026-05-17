import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { I } from "../icons";
import { t, useLang } from "../i18n";

type BranchEntry = {
  name: string;
  current: boolean;
  kind: "local" | "remote";
};

type Anchor = { left: number };

export function GitBranchPop({
  open,
  onClose,
  workspaceDir,
  anchor,
  onSwitchDone,
}: {
  open: boolean;
  onClose: () => void;
  workspaceDir: string | undefined;
  anchor?: Anchor;
  onSwitchDone?: () => void;
}) {
  useLang();
  const [query, setQuery] = useState("");
  const [branches, setBranches] = useState<BranchEntry[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    if (!workspaceDir) return;
    invoke<BranchEntry[]>("git_branch_list", { root: workspaceDir })
      .then(setBranches)
      .catch(() => setBranches([]));
  }, [workspaceDir]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setError(null);
    load();
    const id = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(id);
  }, [open, load]);

  const current = useMemo(() => branches.find((b) => b.current), [branches]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, query]);

  const handleSwitch = useCallback(
    (b: BranchEntry) => {
      if (!workspaceDir || b.current) return;
      setSwitching(b.name);
      setError(null);
      invoke("git_checkout", { root: workspaceDir, branch: b.name })
        .then(() => {
          load();
          onSwitchDone?.();
          setSwitching(null);
        })
        .catch((err) => {
          setError(String(err));
          setSwitching(null);
        });
    },
    [workspaceDir, load],
  );

  if (!open) return null;

  return (
    <div className="wd-mask" onMouseDown={onClose}>
      <div
        className="wd-pop"
        style={{ bottom: 32, left: anchor?.left ?? 120, maxWidth: 320 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="wd-head">
          <I.branch size={12} />
          <span>{current?.name ?? t("gitNoBranch")}</span>
          <span
            style={{
              marginLeft: "auto",
              fontFamily: "inherit",
              fontSize: 10,
              color: "var(--muted)",
            }}
          >
            ⌘B
          </span>
        </div>
        <input
          ref={inputRef}
          className="wd-search"
          placeholder={t("gitSearchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (e.key === "Enter" && items[0] && !items[0].current) {
              e.preventDefault();
              handleSwitch(items[0]);
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
              {query ? t("gitEmptySearch") : t("gitEmpty")}
            </div>
          ) : null}
          {items.map((b) => {
            const isCurrent = b.current;
            const busy = switching === b.name;
            return (
              <div
                key={b.name}
                className="wd-row"
                onClick={() => {
                  if (!isCurrent && !busy) handleSwitch(b);
                }}
                title={b.name}
                style={{ opacity: busy ? 0.5 : 1 }}
              >
                <span className="ic">
                  <I.branch size={11} />
                </span>
                <div className="b">
                  <div className="p">
                    {b.name}
                    {b.kind === "remote" ? (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 10,
                          color: "var(--muted-2)",
                          fontFamily: "inherit",
                        }}
                      >
                        remote
                      </span>
                    ) : null}
                  </div>
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
        {error ? (
          <div
            style={{
              padding: "6px 12px",
              fontSize: 11,
              color: "var(--danger)",
              borderTop: "1px solid var(--border)",
            }}
          >
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
