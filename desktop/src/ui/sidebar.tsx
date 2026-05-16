import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { I } from "../icons";
import type { SessionInfo } from "../App";

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
    return `会话 ${month}-${day} ${hh}:${mm}`;
  }
  return name.replace(/^desktop-/, "").replace(/[-_]+/g, " ");
}

function relative(ms: number): string {
  const min = ms / 60_000;
  if (min < 1) return "刚刚";
  if (min < 60) return `${Math.floor(min)} 分钟前`;
  const hr = min / 60;
  if (hr < 24) return `${Math.floor(hr)} 小时前`;
  const d = hr / 24;
  if (d < 7) return `${Math.floor(d)} 天前`;
  return `${Math.floor(d / 7)} 周前`;
}

function folderName(path: string): string {
  const seg = path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .filter(Boolean)
    .pop();
  return seg || path || "工作区";
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

export function Sidebar({
  sessions,
  openTabs,
  activeTabId,
  activeSession,
  onActivateTab,
  onNewChat,
  onOpenSession,
  onNewSession,
  onCloseTab,
  onDeleteSession,
  onAddWorkspace,
  onOpenSettings,
  onOpenRules,
  onOpenCommands,
}: {
  sessions: SessionInfo[];
  openTabs: OpenTab[];
  activeTabId: string;
  activeSession?: string;
  onActivateTab: (id: string) => void;
  onNewChat: () => void;
  onOpenSession: (name: string) => void;
  onNewSession: (workspaceDir: string) => void;
  onCloseTab: (id: string) => void;
  onDeleteSession: (name: string) => void;
  onAddWorkspace: () => void;
  onOpenSettings: () => void;
  onOpenRules: () => void;
  onOpenCommands: () => void;
}) {
  const [query, setQuery] = useState("");
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [menu, setMenu] = useState<SessionMenuState | null>(null);
  const [folderMenu, setFolderMenu] = useState<FolderMenuState | null>(null);
  const [renaming, setRenaming] = useState<{ name: string; value: string } | null>(null);

  const [hiddenWs, setHiddenWs] = useState<Set<string>>(() => loadSet("reasonix.hiddenWorkspaces"));
  const [pinnedWs, setPinnedWs] = useState<Set<string>>(() => loadSet("reasonix.pinnedWorkspaces"));
  const [pinnedSessions, setPinnedSessions] = useState<Set<string>>(() => loadSet("reasonix.pinnedSessions"));
  const [customTitles, setCustomTitles] = useState<Map<string, string>>(() => loadMap("reasonix.sessionTitles"));

  const activeSessionName =
    openTabs.find((t) => t.id === activeTabId)?.sessionName ?? activeSession;

  const hideWorkspace = (key: string) => {
    setHiddenWs((prev) => {
      const next = new Set(prev);
      next.add(key);
      saveSet("reasonix.hiddenWorkspaces", next);
      return next;
    });
  };

  const togglePinWs = (key: string) => {
    setPinnedWs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      saveSet("reasonix.pinnedWorkspaces", next);
      return next;
    });
  };

  const togglePinSession = (name: string) => {
    setPinnedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      saveSet("reasonix.pinnedSessions", next);
      return next;
    });
  };

  const commitRename = (name: string, value: string) => {
    setCustomTitles((prev) => {
      const next = new Map(prev);
      const trimmed = value.trim();
      if (trimmed) next.set(name, trimmed); else next.delete(name);
      saveMap("reasonix.sessionTitles", next);
      return next;
    });
    setRenaming(null);
  };

  const groups = useMemo(() => {
    const openByName = new Map<string, { id: string; busy?: boolean }>();
    for (const t of openTabs) if (t.sessionName) openByName.set(t.sessionName, { id: t.id, busy: t.busy });

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
    const byWorkspace = new Map<string, { display: string; list: TreeSession[] }>();
    for (const s of bySession.values()) {
      const displayTitle = prettyName(s.name, s.summary, customTitles.get(s.name));
      if (q && !displayTitle.toLowerCase().includes(q) && !s.name.toLowerCase().includes(q)) continue;
      const ws = s.workspace || "";
      const key = ws.toLowerCase();
      const g = byWorkspace.get(key);
      if (g) g.list.push(s);
      else byWorkspace.set(key, { display: ws, list: [s] });
    }

    // Keep workspace folders visible even when all their sessions are deleted,
    // as long as there is an open tab still pointing to that directory.
    for (const t of openTabs) {
      if (t.workspaceDir) {
        const ws = normWs(t.workspaceDir);
        const key = ws.toLowerCase();
        if (!byWorkspace.has(key)) {
          byWorkspace.set(key, { display: ws, list: [] });
        }
      }
    }

    const result = [...byWorkspace.entries()].map(([key, { display, list }]) => {
      list.sort((a, b) => {
        const ap = pinnedSessions.has(a.name) ? 0 : 1;
        const bp = pinnedSessions.has(b.name) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return Date.parse(b.mtime) - Date.parse(a.mtime);
      });
      return {
        key,
        ws: display,
        list,
        hasOpen: list.some((s) => s.openTabId),
        pinned: pinnedWs.has(key),
      };
    });

    result.sort((a, b) => {
      const ap = a.pinned ? 0 : 1;
      const bp = b.pinned ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return Date.parse(b.list[0]?.mtime ?? "0") - Date.parse(a.list[0]?.mtime ?? "0");
    });

    return result.filter((g) => !hiddenWs.has(g.key));
  }, [sessions, openTabs, query, hiddenWs, pinnedWs, pinnedSessions, customTitles]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest(".session-menu")) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [menu]);

  useEffect(() => {
    if (!folderMenu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest(".folder-menu")) setFolderMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFolderMenu(null); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [folderMenu]);

  const isExpanded = (ws: string, hasOpen: boolean) =>
    overrides.get(ws) ?? (hasOpen || query.trim().length > 0);

  const toggleFolder = (ws: string, cur: boolean) => {
    setOverrides((prev) => { const next = new Map(prev); next.set(ws, !cur); return next; });
  };

  return (
    <aside className="sidebar">
      <div className="side-head">
        <button type="button" className="new-btn" onClick={onNewChat}>
          <I.plus size={14} />
          <span>新会话</span>
          <kbd>⌘N</kbd>
        </button>
        <button type="button" className="icon-btn" title="命令面板" onClick={onOpenCommands}>
          <I.history size={14} />
        </button>
      </div>

      <div className="search-row">
        <div className="input">
          <I.search size={13} />
          <input
            placeholder="搜索会话…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>⌘K</kbd>
        </div>
      </div>

      <div className="session-list">
        {groups.length === 0 ? (
          <div className="tree-empty">{query ? "无匹配结果" : "暂无会话"}</div>
        ) : null}
        {groups.map(({ key, ws, list, hasOpen, pinned }) => {
          const expanded = isExpanded(key, hasOpen);
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
                <span className="tw-chev"><I.chev size={12} /></span>
                <span className="tw-ico"><I.folder size={13} /></span>
                <span className="tw-name">{folderName(ws)}</span>
                {pinned ? <span className="tw-pin"><I.pin size={10} /></span> : null}
                <span className="tw-count">{list.length}</span>
                {ws ? (
                  <button
                    type="button"
                    className="tw-add"
                    title="在此工作区新建会话"
                    onClick={(e) => { e.stopPropagation(); onNewSession(ws); }}
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
                              onChange={(e) =>
                                setRenaming({ name: s.name, value: e.target.value })
                              }
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
                                <span className="ts-pin-ico"><I.pin size={10} /></span>
                              ) : null}
                              {displayTitle}
                            </span>
                          )}
                          {!isRenaming && (
                            <span className="ts-meta">
                              <span>{s.messageCount} 条</span>
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
          <span className="ico"><I.plus size={13} /></span>
          <span>添加工作区</span>
        </div>
        <div className="row" onClick={onOpenRules}>
          <span className="ico"><I.shield size={13} /></span>
          <span>审批规则</span>
        </div>
        <div className="row" onClick={onOpenSettings}>
          <span className="ico"><I.cog size={13} /></span>
          <span>设置</span>
          <span className="right">⌘,</span>
        </div>
      </div>

      {menu ? (
        <SessionMenu
          menu={menu}
          pinned={pinnedSessions.has(menu.session.name)}
          customTitle={customTitles.get(menu.session.name)}
          onStop={(id) => { onCloseTab(id); setMenu(null); }}
          onDelete={(name) => { onDeleteSession(name); setMenu(null); }}
          onRename={(name, currentTitle) => {
            setMenu(null);
            setRenaming({ name, value: currentTitle });
          }}
          onTogglePin={(name) => { togglePinSession(name); setMenu(null); }}
        />
      ) : null}

      {folderMenu ? (
        <FolderMenu
          menu={folderMenu}
          pinned={pinnedWs.has(folderMenu.key)}
          onHide={(key) => { hideWorkspace(key); setFolderMenu(null); }}
          onTogglePin={(key) => { togglePinWs(key); setFolderMenu(null); }}
          onOpenInExplorer={(ws) => { openPath(ws).catch(console.error); setFolderMenu(null); }}
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
    if (left + rect.width + pad > window.innerWidth) left = Math.max(pad, window.innerWidth - rect.width - pad);
    if (top + rect.height + pad > window.innerHeight) top = Math.max(pad, window.innerHeight - rect.height - pad);
    if (left !== pos.left || top !== pos.top) setPos({ left, top });
  }, [menu.x, menu.y, pos.left, pos.top]);

  return (
    <div ref={ref} className="session-menu" style={{ left: pos.left, top: pos.top }}>
      <div className="sm-name">{displayTitle}</div>

      {!confirmingDelete ? (
        <>
          <button type="button" className="sm-item" onClick={() => onTogglePin(s.name)}>
            {pinned ? <I.pinOff size={13} /> : <I.pin size={13} />}
            <span>{pinned ? "取消置顶" : "置顶"}</span>
          </button>

          <button type="button" className="sm-item" onClick={() => onRename(s.name, displayTitle)}>
            <I.pencil size={13} />
            <span>重命名</span>
          </button>

          <div className="sm-sep" />
          <button
            type="button"
            className="sm-item"
            disabled={!s.running}
            onClick={() => { if (s.openTabId) onStop(s.openTabId); }}
          >
            <I.stop size={13} />
            <span>停止运行</span>
          </button>

          <div className="sm-sep" />
          <button
            type="button"
            className="sm-item danger"
            onClick={() => setConfirmingDelete(true)}
          >
            <I.trash size={13} />
            <span>删除会话</span>
          </button>
        </>
      ) : (
        <div className="sm-confirm">
          <div className="sm-confirm-icon">
            <I.trash size={16} />
          </div>
          <p className="sm-confirm-title">删除会话</p>
          <p className="sm-confirm-desc">「{displayTitle}」将被永久删除，无法恢复。</p>
          <div className="sm-confirm-actions">
            <button
              type="button"
              className="sm-confirm-cancel"
              onClick={() => setConfirmingDelete(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="sm-confirm-ok"
              onClick={() => onDelete(s.name)}
            >
              删除
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
  onHide,
  onTogglePin,
  onOpenInExplorer,
}: {
  menu: FolderMenuState;
  pinned: boolean;
  onHide: (key: string) => void;
  onTogglePin: (key: string) => void;
  onOpenInExplorer: (ws: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let left = menu.x;
    let top = menu.y;
    if (left + rect.width + pad > window.innerWidth) left = Math.max(pad, window.innerWidth - rect.width - pad);
    if (top + rect.height + pad > window.innerHeight) top = Math.max(pad, window.innerHeight - rect.height - pad);
    if (left !== pos.left || top !== pos.top) setPos({ left, top });
  }, [menu.x, menu.y, pos.left, pos.top]);

  return (
    <div ref={ref} className="folder-menu session-menu" style={{ left: pos.left, top: pos.top }}>
      <div className="sm-name">{folderName(menu.ws) || "工作区"}</div>

      <button type="button" className="sm-item" onClick={() => onTogglePin(menu.key)}>
        {pinned ? <I.pinOff size={13} /> : <I.pin size={13} />}
        <span>{pinned ? "取消置顶" : "置顶"}</span>
      </button>

      <button type="button" className="sm-item" onClick={() => onOpenInExplorer(menu.ws)}>
        <I.folder size={13} />
        <span>资源管理器打开</span>
      </button>

      <div className="sm-sep" />
      <button type="button" className="sm-item danger" onClick={() => onHide(menu.key)}>
        <I.x size={13} />
        <span>移除</span>
      </button>
    </div>
  );
}
