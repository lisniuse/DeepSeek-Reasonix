import { useEffect, useState } from "react";

const SPLASH_FLAG = "reasonix.splash.shown";

export function shouldShowSplash(): boolean {
  try {
    return sessionStorage.getItem(SPLASH_FLAG) !== "1";
  } catch {
    return true;
  }
}

function markSplashShown() {
  try {
    sessionStorage.setItem(SPLASH_FLAG, "1");
  } catch {
    /* sessionStorage unavailable */
  }
}

export function Splash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const finish = () => {
      markSplashShown();
      onDone();
    };
    const t1 = window.setTimeout(() => setLeaving(true), 1350);
    const t2 = window.setTimeout(finish, 1800);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [onDone]);

  useEffect(() => {
    const skip = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Enter" && e.key !== " ") return;
      markSplashShown();
      onDone();
    };
    window.addEventListener("keydown", skip);
    return () => window.removeEventListener("keydown", skip);
  }, [onDone]);

  const skipClick = () => {
    markSplashShown();
    onDone();
  };

  return (
    <div className="splash" data-leaving={leaving} onClick={skipClick}>
      <div className="splash-card">
        <div className="splash-mark" />
        <div className="splash-name">Reasonix</div>
        <div className="splash-sub">DeepSeek Agents</div>
        <div className="splash-dots">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
