import { I } from "../icons";
import { t } from "../i18n";
import type { Balance, Settings, UsageStats } from "../App";
import type { JobInfo } from "../protocol";
import { THEME, type Theme } from "../theme";

function formatMoney(amount: number, currency: "CNY" | "USD"): string {
  const symbol = currency === "CNY" ? "¥" : "$";
  return `${symbol} ${amount.toFixed(4)}`;
}

function tokenLabel(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

export function StatusBar({
  settings,
  balance,
  usage,
  busy,
  ready,
  currency,
  theme,
  jobs,
  jobsOpen,
  onToggleJobs,
  onToggleTheme,
  onToggleCurrency,
  onOpenSettings,
  gitBranch,
  onToggleGit,
  gitRef,
}: {
  settings: Settings | null;
  balance: Balance | null;
  usage: UsageStats;
  busy: boolean;
  ready: boolean;
  currency: "CNY" | "USD";
  theme: Theme;
  jobs: JobInfo[];
  jobsOpen: boolean;
  onToggleJobs: () => void;
  onToggleTheme: () => void;
  onToggleCurrency: () => void;
  onOpenSettings: () => void;
  gitBranch: string | null;
  onToggleGit: () => void;
  gitRef: React.RefObject<HTMLSpanElement | null>;
}) {
  const totalTokens = usage.cacheHitTokens + usage.cacheMissTokens;
  const cacheHitPct = totalTokens > 0 ? Math.round((usage.cacheHitTokens / totalTokens) * 100) : 0;
  const runningJobs = jobs.filter((j) => j.running).length;
  const spent = formatMoney(usage.totalCostUsd, currency);
  const balanceLabel = balance
    ? `${balance.currency === "USD" ? "$" : "¥"} ${balance.total.toFixed(2)}`
    : "—";
  const connState = !ready ? "off" : busy ? "running" : "online";
  return (
    <footer className="statusbar">
      <span
        ref={gitRef}
        className="seg"
        title={gitBranch ? `git branch: ${gitBranch}` : "git branch"}
        onClick={onToggleGit}
        style={{ cursor: "pointer" }}
      >
        <I.branch size={11} style={{ color: gitBranch ? "var(--violet)" : "var(--muted)" }} />
        <span className="v vio">{gitBranch ?? "—"}</span>
      </span>
      <span className="seg" title={`API · ${settings?.baseUrl ?? "api.deepseek.com"}`}>
        <span
          className={connState === "off" ? "sw warn" : "sw"}
          style={connState === "off" ? { background: "var(--danger)" } : undefined}
        />
        <span>{settings?.baseUrl?.replace(/^https?:\/\//, "") ?? "api.deepseek.com"}</span>
        <span className="v">{!ready ? t("statusbar.offline") : busy ? t("statusbar.busy") : t("statusbar.online")}</span>
      </span>
      <span className="seg" title="cache hit">
        <I.zap size={11} style={{ color: "var(--accent)" }} />
        <span>{t("statusbar.cache")}</span>
        <span className="v acc">{cacheHitPct}%</span>
      </span>
      <span className="seg">
        <I.cpu size={11} />
        <span>{t("statusbar.tokens")}</span>
        <span className="v">{tokenLabel(totalTokens)}</span>
      </span>
      <span className="seg">
        <I.coin size={11} />
        <span>{t("statusbar.sessionCost")}</span>
        <span className="v ok">{spent}</span>
      </span>

      <span className="grow" />

      <span
        className={`seg jobs ${jobsOpen ? "active" : ""}`}
        onClick={onToggleJobs}
        title={t("statusbar.jobsTip")}
      >
        <I.cpu size={11} />
        <span>{t("statusbar.jobs")}</span>
        <span className={runningJobs > 0 ? "v acc" : "v"}>{runningJobs}</span>
      </span>

      <span
        className="seg"
        title={`model · preset ${settings?.preset ?? "auto"}`}
        onClick={onOpenSettings}
      >
        <I.brain size={11} style={{ color: "var(--violet)" }} />
        <span className="v vio">{settings?.model ?? "—"}</span>
      </span>
      <span className="seg" title="切换货币 (CNY / USD)" onClick={onToggleCurrency}>
        <I.coin size={11} />
        <span>{t("statusbar.balance")}</span>
        <span className="v ok">{balanceLabel}</span>
      </span>
      <span className="seg" title="切换主题" onClick={onToggleTheme}>
        {theme === THEME.DARK ? <I.moon size={11} /> : <I.sun size={11} />}
        <span className="v">{theme === THEME.DARK ? t("statusbar.dark") : t("statusbar.light")}</span>
      </span>
    </footer>
  );
}
