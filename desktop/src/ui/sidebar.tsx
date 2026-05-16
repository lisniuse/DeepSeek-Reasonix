import { openPath } from "@tauri-apps/plugin-opener";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { SessionInfo } from "../App";
import { t, useLang } from "../i18n";
import { I } from "../icons";

type OpenTab = { id: string; workspaceDir?: string; sessionName?: string; busy?: boolean };

type TreeSession = {
  name: string;
  workspace: string;
  messageCount: number;
  mtime: string;
  summary?: string;
  openTabId?: string;
  running?: boolean;
};

type SessionMenuState = { session: TreeSession; x: number; y: number };
type FolderMenuState = { key: string; ws: string; x: number; y: number };

function prettyName(name: string, summary?: string, customTitle?: string): string {
  if (customTitle) return customTitle;
  if (summary && summary.trim()) return summary.trim();
  const m = name.match(/^desktop-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(?:-(\d+))?$/);
  if (m) {
    const [, , month, day, hh, mm] = m;
    return t("app.session.format", { month, day, hour: hh, minute: mm });
  }
  return name.replace(/^desktop-/, "").replace(/[-_]+/g, " ");
}

function relative(ms: number): string {
  const min = ms / 60_000;
  if (min < 1) return t("time.justNow");
  if (min < 60) return t("time.minutesAgo", { n: String(Math.floor(min)) });
  const hr = min / 60;
  if (hr < 24) return t("time.hoursAgo", { n: String(Math.floor(hr)) });
  const d = hr / 24;
  if (d < 7) return t("time.daysAgo", { n: String(Math.floor(d)) });
  return t("time.weeksAgo", { n: String(Math.floor(d / 7)) });
}

function folderName(path: string): string {
  const seg = path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .filter(Boolean)
    .pop();
  return seg || path || t("sidebar.unnamedWorkspace");
}

function normWs(p: string): string {
  if (!p) return "";
  return p
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .replace(/^([A-Za-z]):/, (_, d: string) => `${d.toLowerCase()}:`);
}

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveSet(key: string, s: Set<string>) {
  localStorage.setItem(key, JSON.stringify([...s]));
}

function loadMap(key: string): Map<string, string> {
  try {
    const raw = localStorage.getItem(key);
    return new Map(raw ? Object.entries(JSON.parse(raw) as Record<string, string>) : []);
  } catch {
    return new Map();
  }
}

function saveMap(key: string, m: Map<string, string>) {
  localStorage.setItem(key, JSON.stringify(Object.fromEntries(m)));
}

// Per-tab TabRuntime means there is one Sidebar instance per open tab. Folder
// collapse state must be shared across them — a module-level store keeps every
// instance in sync. localStorage alone can't: same-document writes don't fire
// the `storage` event, so sibling instances would never see each other's edits.
let collapsedWsValue = loadSet("reasonix.collapsedWorkspaces");
const collapsedWsListeners = new Set<() => void>();
function subscribeCollapsedWs(cb: () => void): () => void {
  collapsedWsListeners.add(cb);
  return () => {
    collapsedWsListeners.delete(cb);
  };
}
function getCollapsedWs(): Set<string> {
  return collapsedWsValue;
}
function setCollapsedWs(next: Set<string>): void {
  collapsedWsValue = next;
  saveSet("reasonix.collapsedWorkspaces", next);
  for (const cb of collapsedWsListeners) cb();
}

export function Sidebar({
  sessions,
  openTabs,
  recentWorkspaces,
  activeTabId,
  activeSession,
  onActivateTab,
  onNewChat,
  onOpenSession,
  onNewSession,
  onCloseTab,
  onDeleteSession,
  onAddWorkspace,
  onRemoveWorkspace,
  onOpenSettings,
  onOpenRules,
  onOpenCommands,
}: {
  sessions: SessionInfo[];
  openTabs: OpenTab[];
  recentWorkspaces: string[];
  activeTabId: string;
  activeSession?: string;
  onActivateTab: (id: string) => void;
  onNewChat: () => void;
  onOpenSession: (name: string) => void;
  onNewSession: (workspaceDir: string) => void;
  onCloseTab: (id: string) => void;
  onDeleteSession: (name: string) => void;
  onAddWorkspace: () => void;
  onRemoveWorkspace: (path: string) => void;
  onOpenSettings: () => void;
  onOpenRules: () => void;
  onOpenCommands: () => void;
}) {
  const [query, setQuery] = useState("");
  const collapsedWs = useSyncExternalStore(subscribeCollapsedWs, getCollapsedWs);
  const [menu, setMenu] = useState<SessionMenuState | null>(null);
  const [folderMenu, setFolderMenu] = useState<FolderMenuState | null>(null);
  const [renaming, setRenaming] = useState<{ name: string; value: string } | null>(null);

  const [hiddenWs, setHiddenWs] = useState<Set<string>>(() => loadSet("reasonix.hiddenWorkspaces"));
  const [pinnedWs, setPinnedWs] = useState<Set<string>>(() => loadSet("reasonix.pinnedWorkspaces"));
  const [pinnedSessions, setPinnedSessions] = useState<Set<string>>(() =>
    loadSet("reasonix.pinnedSessions"),
  );
  const [customTitles, setCustomTitles] = useState<Map<string, string>>(() =>
    loadMap("reasonix.sessionTitles"),
  );

  const lang = useLang();

  const activeSessionName =
    openTabs.find((t) => t.id === activeTabId)?.sessionName ?? activeSession;

  const deleteWorkspace = (key: string, ws: string) => {
    // Clean up any legacy hidden-workspace entry, then truly remove from recentWorkspaces.
    setHiddenWs((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      saveSet("reasonix.hiddenWorkspaces", next);
      return next;
    });
    onRemoveWorkspace(ws);
  };

  const togglePinWs = (key: string) => {
    setPinnedWs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveSet("reasonix.pinnedWorkspaces", next);
      return next;
    });
  };

  const togglePinSession = (name: string) => {
    setPinnedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      saveSet("reasonix.pinnedSessions", next);
      return next;
    });
  };

  const commitRename = (name: string, value: string) => {
    setCustomTitles((prev) => {
      const next = new Map(prev);
      const trimmed = value.trim();
      if (trimmed) next.set(name, trimmed);
      else next.delete(name);
      saveMap("reasonix.sessionTitles", next);
      return next;
    });
    setRenaming(null);
  };

  const groups = useMemo(() => {
    const openByName = new Map<string, { id: string; busy?: boolean }>();
    for (const t of openTabs)
      if (t.sessionName) openByName.set(t.sessionName, { id: t.id, busy: t.busy });

    const bySession = new Map<string, TreeSession>();
    for (const s of sessions) {
      const tab = openByName.get(s.name);
      bySession.set(s.name, {
        ...s,
        workspace: normWs(s.workspace),
        openTabId: tab?.id,
        running: tab?.busy ?? false,
      });
    }
    for (const t of openTabs) {
      if (t.sessionName && !bySession.has(t.sessionName)) {
        bySession.set(t.sessionName, {
          name: t.sessionName,
          workspace: normWs(t.workspaceDir ?? ""),
          messageCount: 0,
          mtime: new Date().toISOString(),
          openTabId: t.id,
          running: t.busy ?? false,
        });
      }
    }

    const q = query.trim().toLowerCase();

    // Build a canonical set of workspace folders from recentWorkspaces (the
    // same source the workdir pop uses) so both panels stay in sync. Then
    // distribute sessions into those folders. Workspaces that only appear
    // via sessions (not in recent) are also included so nothing is lost.
    const wsSet = new Map<string, string>(); // key → display name
    for (const p of recentWorkspaces) {
      const ws = normWs(p);
      wsSet.set(ws.toLowerCase(), ws);
    }

    // Add session workspaces that aren't already in the set.
    for (const s of bySession.values()) {
      const ws = s.workspace || "";
      const key = ws.toLowerCase();
      if (!wsSet.has(key)) wsSet.set(key, ws);
    }
    // Add open-tab workspaces.
    for (const t of openTabs) {
      if (t.workspaceDir) {
        const ws = normWs(t.workspaceDir);
        const key = ws.toLowerCase();
        if (!wsSet.has(key)) wsSet.set(key, ws);
      }
    }

    const byWorkspace = new Map<string, { display: string; list: TreeSession[] }>();
    for (const [key, display] of wsSet) {
      byWorkspace.set(key, { display, list: [] });
    }
    for (const s of bySession.values()) {
      const displayTitle = prettyName(s.name, s.summary, customTitles.get(s.name));
      if (q && !displayTitle.toLowerCase().includes(q) && !s.name.toLowerCase().includes(q))
        continue;
      const key = (s.workspace || "").toLowerCase();
      const g = byWorkspace.get(key);
      if (g) g.list.push(s);
    }

    const result = [...byWorkspace.entries()].map(([key, { display, list }]) => {
      list.sort((a, b) => {
        const ap = pinnedSessions.has(a.name) ? 0 : 1;
        const bp = pinnedSessions.has(b.name) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return Date.parse(b.mtime) - Date.parse(a.mtime);
      });
      return { key, ws: display, list, pinned: pinnedWs.has(key) };
    });

    result.sort((a, b) => {
      const ap = a.pinned ? 0 : 1;
      const bp = b.pinned ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return Date.parse(b.list[0]?.mtime ?? "0") - Date.parse(a.list[0]?.mtime ?? "0");
    });

    // Hide hidden workspaces, and hide empty folders when searching
    return result.filter((g) => {
      if (hiddenWs.has(g.key)) return false;
      if (q && g.list.length === 0) return false;
      return true;
    });
  }, [sessions, openTabs, recentWorkspaces, query, hiddenWs, pinnedWs, pinnedSessions, customTitles, lang]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest(".session-menu")) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  useEffect(() => {
    if (!folderMenu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest(".folder-menu")) setFolderMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFolderMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [folderMenu]);

  // Folders are expanded by default; only explicitly user-collapsed folders are tracked.
  // Clicking a session never touches this set — only clicking the folder header does.
  const isExpanded = (key: string) => !collapsedWs.has(key) || query.trim().length > 0;

  const toggleFolder = (key: string, expanded: boolean) => {
    const next = new Set(getCollapsedWs());
    if (expanded) next.add(key);
    else next.delete(key);
    setCollapsedWs(next);
  };

  return (
    <aside className="sidebar">
      <div className="side-head">
        <button type="button" className="new-btn" onClick={onNewChat}>
          <I.plus size={14} />
          <span>{t("sidebar.newChat")}</span>
          <kbd>⌘N</kbd>
        </button>
        <button type="button" className="icon-btn" title={t("app.titlebar.commandPalette")} onClick={onOpenCommands}>
          <I.history size={14} />
        </button>
      </div>

      <div className="search-row">
        <div className="input">
          <I.search size={13} />
          <input placeholder={t("sidebar.searchPlaceholder")} value={query} onChange={(e) => setQuery(e.target.value)} />
          <kbd>⌘K</kbd>
        </div>
      </div>

      <div className="session-list">
        {groups.length === 0 ? (
          <div className="tree-empty">{query ? t("sidebar.noMatches") : t("sidebar.noSessions")}</div>
        ) : null}
        {groups.map(({ key, ws, list, pinned }) => {
          const expanded = isExpanded(key);
          return (
            <div className="tree-folder" key={key || "(none)"}>
              <div
                className="tree-folder-head"
                data-expanded={expanded}
                data-pinned={pinned}
                onClick={() => toggleFolder(key, expanded)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setFolderMenu({ key, ws, x: e.clientX, y: e.clientY });
                }}
                title={ws}
              >
                <span className="tw-chev">
                  <I.chev size={12} />
                </span>
                <span className="tw-ico">
                  <I.folder size={13} />
                </span>
                <span className="tw-name">{folderName(ws)}</span>
                {pinned ? (
                  <span className="tw-pin">
                    <I.pin size={10} />
                  </span>
                ) : null}
                <span className="tw-count">{list.length}</span>
                {ws ? (
                  <button
                    type="button"
                    className="tw-add"
                    title={t("sidebar.newSessionInWorkspace")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onNewSession(ws);
                    }}
                  >
                    <I.plus size={12} />
                  </button>
                ) : null}
              </div>
              {expanded
                ? list.map((s) => {
                    const open = !!s.openTabId;
                    const active = s.name === activeSessionName;
                    const pinned = pinnedSessions.has(s.name);
                    const mtime = Date.parse(s.mtime);
                    const updated = Number.isFinite(mtime) ? relative(Date.now() - mtime) : "";
                    const displayTitle = prettyName(s.name, s.summary, customTitles.get(s.name));
                    const isRenaming = renaming?.name === s.name;

                    return (
                      <div
                        key={s.name}
                        className="tree-session"
                        data-active={active}
                        data-open={open}
                        role="button"
                        tabIndex={0}
                        title={isRenaming ? undefined : displayTitle}
                        onClick={() => {
                          if (isRenaming) return;
                          if (s.openTabId) onActivateTab(s.openTabId);
                          else onOpenSession(s.name);
                        }}
                        onKeyDown={(e) => {
                          if (isRenaming || e.key !== "Enter") return;
                          if (s.openTabId) onActivateTab(s.openTabId);
                          else onOpenSession(s.name);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setMenu({ session: s, x: e.clientX, y: e.clientY });
                        }}
                      >
                        <span className="ts-dot" data-on={open} />
                        <div className="ts-body">
                          {isRenaming ? (
                            <input
                              className="ts-rename-input"
                              autoFocus
                              value={renaming.value}
                              onChange={(e) => setRenaming({ name: s.name, value: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitRename(s.name, renaming.value);
                                if (e.key === "Escape") setRenaming(null);
                                e.stopPropagation();
                              }}
                              onBlur={() => commitRename(s.name, renaming.value)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <span className="ts-title">
                              {pinned ? (
                                <span className="ts-pin-ico">
                                  <I.pin size={10} />
                                </span>
                              ) : null}
                              {displayTitle}
                            </span>
                          )}
                          {!isRenaming && (
                            <span className="ts-meta">
                              <span>{t("sidebar.messageCount", { count: String(s.messageCount) })}</span>
                              {updated ? (
                                <>
                                  <span className="sep">·</span>
                                  <span>{updated}</span>
                                </>
                              ) : null}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                : null}
            </div>
          );
        })}
      </div>

      <div className="side-foot">
        <div className="row" onClick={onAddWorkspace}>
          <span className="ico">
            <I.plus size={13} />
          </span>
          <span>{t("sidebar.addWorkspace")}</span>
        </div>
        <div className="row" onClick={onOpenRules}>
          <span className="ico">
            <I.shield size={13} />
          </span>
          <span>{t("sidebar.approvalRules")}</span>
        </div>
        <div className="row" onClick={onOpenSettings}>
          <span className="ico">
            <I.cog size={13} />
          </span>
          <span>{t("sidebar.settings")}</span>
          <span className="right">⌘,</span>
        </div>
      </div>

      {menu ? (
        <SessionMenu
          menu={menu}
          pinned={pinnedSessions.has(menu.session.name)}
          customTitle={customTitles.get(menu.session.name)}
          onStop={(id) => {
            onCloseTab(id);
            setMenu(null);
          }}
          onDelete={(name) => {
            onDeleteSession(name);
            setMenu(null);
          }}
          onRename={(name, currentTitle) => {
            setMenu(null);
            setRenaming({ name, value: currentTitle });
          }}
          onTogglePin={(name) => {
            togglePinSession(name);
            setMenu(null);
          }}
        />
      ) : null}

      {folderMenu ? (
        <FolderMenu
          menu={folderMenu}
          pinned={pinnedWs.has(folderMenu.key)}
          sessionCount={groups.find((g) => g.key === folderMenu.key)?.list.length ?? 0}
          onDelete={(key, ws) => {
            deleteWorkspace(key, ws);
            setFolderMenu(null);
          }}
          onTogglePin={(key) => {
            togglePinWs(key);
            setFolderMenu(null);
          }}
          onOpenInExplorer={(ws) => {
            openPath(ws).catch(console.error);
            setFolderMenu(null);
          }}
        />
      ) : null}
    </aside>
  );
}

function SessionMenu({
  menu,
  pinned,
  customTitle,
  onStop,
  onDelete,
  onRename,
  onTogglePin,
}: {
  menu: SessionMenuState;
  pinned: boolean;
  customTitle?: string;
  onStop: (tabId: string) => void;
  onDelete: (name: string) => void;
  onRename: (name: string, currentTitle: string) => void;
  onTogglePin: (name: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const s = menu.session;
  const displayTitle = prettyName(s.name, s.summary, customTitle);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let left = menu.x;
    let top = menu.y;
    if (left + rect.width + pad > window.innerWidth)
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    if (top + rect.height + pad > window.innerHeight)
      top = Math.max(pad, window.innerHeight - rect.height - pad);
    if (left !== pos.left || top !== pos.top) setPos({ left, top });
  }, [menu.x, menu.y, pos.left, pos.top]);

  return (
    <div ref={ref} className="session-menu" style={{ left: pos.left, top: pos.top }}>
      <div className="sm-name">{displayTitle}</div>

      {!confirmingDelete ? (
        <>
          <button type="button" className="sm-item" onClick={() => onTogglePin(s.name)}>
            {pinned ? <I.pinOff size={13} /> : <I.pin size={13} />}
            <span>{pinned ? t("sidebar.unpin") : t("sidebar.pin")}</span>
          </button>

          <button type="button" className="sm-item" onClick={() => onRename(s.name, displayTitle)}>
            <I.pencil size={13} />
            <span>{t("sidebar.rename")}</span>
          </button>

          <div className="sm-sep" />
          <button
            type="button"
            className="sm-item"
            disabled={!s.running}
            onClick={() => {
              if (s.openTabId) onStop(s.openTabId);
            }}
          >
            <I.stop size={13} />
            <span>{t("sidebar.stopRunning")}</span>
          </button>

          <div className="sm-sep" />
          <button
            type="button"
            className="sm-item danger"
            onClick={() => setConfirmingDelete(true)}
          >
            <I.trash size={13} />
            <span>{t("sidebar.deleteSession")}</span>
          </button>
        </>
      ) : (
        <div className="sm-confirm">
          <div className="sm-confirm-icon">
            <I.trash size={16} />
          </div>
          <p className="sm-confirm-title">{t("sidebar.deleteSessionConfirmTitle")}</p>
          <p className="sm-confirm-desc">{t("sidebar.deleteSessionConfirmDesc", { title: displayTitle })}</p>
          <div className="sm-confirm-actions">
            <button
              type="button"
              className="sm-confirm-cancel"
              onClick={() => setConfirmingDelete(false)}
            >
              {t("sidebar.cancel")}
            </button>
            <button type="button" className="sm-confirm-ok" onClick={() => onDelete(s.name)}>
              {t("sidebar.confirmDelete")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FolderMenu({
  menu,
  pinned,
  sessionCount,
  onDelete,
  onTogglePin,
  onOpenInExplorer,
}: {
  menu: FolderMenuState;
  pinned: boolean;
  sessionCount: number;
  onDelete: (key: string, ws: string) => void;
  onTogglePin: (key: string) => void;
  onOpenInExplorer: (ws: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let left = menu.x;
    let top = menu.y;
    if (left + rect.width + pad > window.innerWidth)
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    if (top + rect.height + pad > window.innerHeight)
      top = Math.max(pad, window.innerHeight - rect.height - pad);
    if (left !== pos.left || top !== pos.top) setPos({ left, top });
  }, [menu.x, menu.y, pos.left, pos.top]);

  return (
    <div ref={ref} className="folder-menu session-menu" style={{ left: pos.left, top: pos.top }}>
      <div className="sm-name">{folderName(menu.ws) || t("sidebar.unnamedWorkspace")}</div>

      {!confirmingDelete ? (
        <>
          <button type="button" className="sm-item" onClick={() => onTogglePin(menu.key)}>
            {pinned ? <I.pinOff size={13} /> : <I.pin size={13} />}
            <span>{pinned ? t("sidebar.unpin") : t("sidebar.pin")}</span>
          </button>

          <button type="button" className="sm-item" onClick={() => onOpenInExplorer(menu.ws)}>
            <I.folder size={13} />
            <span>{t("sidebar.openInExplorer")}</span>
          </button>

          <div className="sm-sep" />
          <button
            type="button"
            className="sm-item danger"
            onClick={() => setConfirmingDelete(true)}
          >
            <I.trash size={13} />
            <span>{t("sidebar.deleteWorkspace")}</span>
          </button>
        </>
      ) : (
        <div className="sm-confirm">
          <div className="sm-confirm-icon">
            <I.trash size={16} />
          </div>
          <p className="sm-confirm-title">{t("sidebar.deleteWorkspaceConfirmTitle")}</p>
          <p className="sm-confirm-desc">
            {sessionCount > 0
              ? t("sidebar.deleteWorkspaceConfirmDesc", { name: folderName(menu.ws) || menu.ws, count: String(sessionCount) })
              : t("sidebar.deleteWorkspaceConfirmDescEmpty", { name: folderName(menu.ws) || menu.ws })}
          </p>
          <div className="sm-confirm-actions">
            <button
              type="button"
              className="sm-confirm-cancel"
              onClick={() => setConfirmingDelete(false)}
            >
              {t("sidebar.cancel")}
            </button>
            <button
              type="button"
              className="sm-confirm-ok"
              onClick={() => onDelete(menu.key, menu.ws)}
            >
              {t("sidebar.confirmDelete")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
