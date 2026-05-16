import { useMemo, useState } from "react";
import type { SessionFile, Settings, UsageStats } from "../App";
import { t, useLang } from "../i18n";
import { I } from "../icons";
import type { McpSpecInfo, MemoryEntryInfo } from "../protocol";

type Tab = "files" | "tools" | "memory" | "rules";

const CONTEXT_MAX_TOKENS = 1_000_000;

export function ContextPanel({
  settings,
  usage,
  mcpSpecs,
  mcpBridged,
  sessionFiles,
  memory,
}: {
  settings: Settings | null;
  usage: UsageStats;
  mcpSpecs: McpSpecInfo[];
  mcpBridged: boolean;
  sessionFiles: SessionFile[];
  memory: MemoryEntryInfo[];
}) {
  useLang();
  const [tab, setTab] = useState<Tab>("files");
  const reserved = usage.reservedTokens;
  // After a warm cache turn the API counts the reserved prefix inside cacheHit;
  // subtract to keep the bar segments visually disjoint. Cold cache shows the
  // reserved portion in cacheMiss instead, so do the same for `used`.
  const cached = Math.max(0, usage.cacheHitTokens - reserved);
  const used = Math.max(0, usage.cacheMissTokens - Math.max(0, reserved - usage.cacheHitTokens));
  const reservedPct = Math.min(100, (reserved / CONTEXT_MAX_TOKENS) * 100);
  const usedPct = Math.min(100, (used / CONTEXT_MAX_TOKENS) * 100);
  const cachedPct = Math.min(100, (cached / CONTEXT_MAX_TOKENS) * 100);
  const free = Math.max(0, CONTEXT_MAX_TOKENS - reserved - used - cached);
  return (
    <aside className="ctx">
      <div className="ctx-tabs">
        <div className="ctx-tab" data-active={tab === "files"} onClick={() => setTab("files")}>
          {t("contextPanel.tabFiles")}
        </div>
        <div className="ctx-tab" data-active={tab === "tools"} onClick={() => setTab("tools")}>
          {t("contextPanel.tabTools")}
        </div>
        <div className="ctx-tab" data-active={tab === "memory"} onClick={() => setTab("memory")}>
          {t("contextPanel.tabMemory")}
        </div>
        <div className="ctx-tab" data-active={tab === "rules"} onClick={() => setTab("rules")}>
          {t("contextPanel.tabRules")}
        </div>
      </div>

      <div className="ctx-body">
        <div className="ctx-block">
          <div className="h">
            <span>{t("contextPanel.contextTokens")}</span>
            <span className="right">
              {(reserved + used + cached).toLocaleString()} /{" "}
              {CONTEXT_MAX_TOKENS.toLocaleString()}
            </span>
          </div>
          <div className="meter">
            <span className="rsvd" style={{ width: `${reservedPct}%` }} />
            <span className="cached" style={{ width: `${cachedPct}%` }} />
            <span className="used" style={{ width: `${usedPct}%` }} />
          </div>
          <div className="legend">
            <span className="l">
              <span className="sw r" />
              {t("contextPanel.reservedKey")} <span className="v">{reserved.toLocaleString()}</span>
            </span>
            <span className="l">
              <span className="sw c" />
              缓存 <span className="v">{cached.toLocaleString()}</span>
            </span>
            <span className="l">
              <span className="sw u" />
              {t("contextPanel.usedKey")} <span className="v">{used.toLocaleString()}</span>
            </span>
            <span className="l">
              余 <span className="v">{free.toLocaleString()}</span>
            </span>
          </div>
        </div>

        {tab === "files" && <CtxFiles files={sessionFiles} />}
        {tab === "tools" && <CtxTools specs={mcpSpecs} bridged={mcpBridged} />}
        {tab === "memory" && <CtxMemory entries={memory} />}
        {tab === "rules" && <CtxRules settings={settings} />}
      </div>
    </aside>
  );
}

type TreeNode =
  | { kind: "dir"; depth: number; name: string; key: string }
  | { kind: "file"; depth: number; name: string; key: string; status: "c" | "m" };

function buildSessionTree(files: SessionFile[]): TreeNode[] {
  const sorted = [...files].sort((a, b) =>
    a.path.replace(/\\/g, "/").localeCompare(b.path.replace(/\\/g, "/")),
  );
  const out: TreeNode[] = [];
  const seenDirs = new Set<string>();
  for (const f of sorted) {
    const parts = f.path.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let prefix = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i] ?? "";
      prefix = prefix ? `${prefix}/${seg}` : seg;
      if (!seenDirs.has(prefix)) {
        seenDirs.add(prefix);
        out.push({ kind: "dir", depth: i, name: seg, key: `d:${prefix}` });
      }
    }
    const leaf = parts[parts.length - 1] ?? "";
    out.push({
      kind: "file",
      depth: parts.length - 1,
      name: leaf,
      key: `f:${f.path}`,
      status: f.status,
    });
  }
  return out;
}

function CtxFiles({ files }: { files: SessionFile[] }) {
  const tree = useMemo(() => buildSessionTree(files), [files]);
  return (
    <div className="ctx-block">
      <div className="h">
        <span>{t("contextPanel.filesHeading")}</span>
        <span className="right">{files.length === 0 ? "—" : t("contextPanel.fileCount", { n: String(files.length) })}</span>
      </div>
      <div className="tree">
        {files.length === 0 ? (
          <div className="ctx-empty">{t("contextPanel.noFilesMsg")}</div>
        ) : (
          tree.map((n) =>
            n.kind === "dir" ? (
              <div className="node" key={n.key} data-d={n.depth} data-kind="dir">
                <span className="ico">
                  <I.folder size={12} />
                </span>
                <span className="nm">{n.name}/</span>
              </div>
            ) : (
              <div
                className="node"
                key={n.key}
                data-d={n.depth}
                data-kind="file"
                title={n.name}
              >
                <span className="ico">
                  <I.file size={12} />
                </span>
                <span className="nm">{n.name}</span>
                <span
                  className="dot"
                  data-s={n.status}
                  title={n.status === "m" ? "modified" : "in context"}
                />
              </div>
            ),
          )
        )}
      </div>
    </div>
  );
}

function CtxTools({ specs, bridged }: { specs: McpSpecInfo[]; bridged: boolean }) {
  const readyCount = specs.filter((s) => s.status === "connected").length;
  return (
    <div className="ctx-block">
      <div className="h">
        <span>{t("contextPanel.mcpHeading")}</span>
        <span className="right">
          {specs.length === 0
            ? "—"
            : bridged
              ? t("contextPanel.mcpReady", { n: String(specs.length) })
              : t("contextPanel.mcpReady", { n: `${readyCount}/${specs.length}` })}
        </span>
      </div>
      {specs.length === 0 ? (
        <div className="ctx-empty">{t("contextPanel.mcpNotConfigured")}</div>
      ) : (
        specs.map((s) => {
          const dot =
            s.status === "connected"
              ? "ok"
              : s.status === "failed" || s.parseError
                ? "off"
                : "pending";
          const suffix = s.statusReason
            ? ` · ${s.statusReason}`
            : s.status === "connected"
              ? typeof s.toolCount === "number"
                ? ` · ${s.toolCount} tools`
                : ` · ${t("contextPanel.mcpStatusReady")}`
              : s.status === "handshake"
                ? ` · ${t("contextPanel.mcpStatusConnecting")}`
                : s.status === "disabled"
                  ? ` · ${t("contextPanel.mcpStatusDisabled")}`
                  : s.status === "failed"
                    ? ` · ${t("contextPanel.mcpStatusFailed")}`
                    : ` · ${t("contextPanel.mcpStatusConfigured")}`;
          return (
            <div className="mcp-row" key={s.raw}>
              <span className="ico">
                <I.wrench size={12} />
              </span>
              <div className="body">
                <div className="n">{s.name ?? s.summary}</div>
                <div className="m">
                  {s.transport}
                  {suffix}
                </div>
              </div>
              <span className="status" data-s={dot} />
            </div>
          );
        })
      )}
    </div>
  );
}

function CtxMemory({ entries }: { entries: MemoryEntryInfo[] }) {
  return (
    <div className="ctx-block">
      <div className="h">
        <span>{t("contextPanel.memoryHeading")}</span>
        <span className="right">{entries.length === 0 ? "—" : t("contextPanel.memoryCount", { n: String(entries.length) })}</span>
      </div>
      {entries.length === 0 ? (
        <div className="ctx-empty">{t("contextPanel.noMemoriesMsg")}</div>
      ) : (
        <div className="mem">
          {entries.map((m) => (
            <div className="mem-row" key={`${m.scope}/${m.name}`}>
              <span className="scope" data-s={m.scope}>
                {m.scope === "project" ? t("contextPanel.memoryScopeProject") : t("contextPanel.memoryScopeGlobal")}
              </span>
              <span className="txt">{m.description || m.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CtxRules({ settings }: { settings: Settings | null }) {
  const editMode = settings?.editMode ?? "review";
  const items: { p: string; allow: boolean; desc: string }[] =
    editMode === "yolo"
      ? [{ p: "*", allow: true, desc: t("contextPanel.yoloModeDesc") }]
      : editMode === "auto"
        ? [
            { p: "read_file, list_directory, search_files, *", allow: true, desc: t("rules.readOnlyDesc") },
            { p: "run_command (allowlist)", allow: true, desc: t("rules.shellWhitelistDesc") },
            { p: "edit_file, write_file, run_command (其他)", allow: false, desc: t("rules.writeRequiresConfirm") },
          ]
        : [
            { p: "*", allow: false, desc: t("contextPanel.reviewModeDesc") },
          ];
  return (
    <div className="ctx-block">
      <div className="h">
        <span>{t("contextPanel.autoApprovalHeading")}</span>
        <span className="right">{editMode}</span>
      </div>
      {items.map((r) => (
        <div className="rule" key={r.p}>
          <div className="top">
            <span className={`pat ${r.allow ? "" : "deny"}`}>{r.p}</span>
            <span className={`sw ${r.allow ? "" : "deny"}`}>{r.allow ? t("contextPanel.allowLabel") : t("contextPanel.askLabel")}</span>
          </div>
          <div className="desc">{r.desc}</div>
        </div>
      ))}
    </div>
  );
}
