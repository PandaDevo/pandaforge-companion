import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import GameLibrariesPage from "./components/GameLibrariesPage";
import LibraryPage from "./components/LibraryPage";
import "./App.css";

type SteamGame = {
  appId: string;
  name: string;
  installDir: string;
  installPath: string;
  libraryPath: string;
  sizeOnDisk: number;
  buildId: string;
  stateFlags: number;
  lastUpdated: number;
  lastPlayed: number;
  steamPlaytimeMinutes: number | null;
  steamPlaytime2weeksMinutes: number | null;
};

type SteamScanResult = {
  steamPath: string;
  libraryPaths: string[];
  games: SteamGame[];
};

type GameAnalytics = {
  appId: string;
  gameName: string;
  totalSeconds: number;
  sessionCount: number;
};

type RecentSession = {
  id: number;
  appId: string;
  gameName: string;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
};

type AnalyticsSummary = {
  totalSeconds: number;
  sessionCount: number;
  uniqueGames: number;
  topGames: GameAnalytics[];
  recentSessions: RecentSession[];
};

const navItems: NavItem[] = [
  { label: "Home", icon: "⌂" },
  { label: "Library", icon: "▦" },
  { label: "Game Health", icon: "✓" },
  { label: "Mods", icon: "◆" },
  { label: "Updates", icon: "↻" },
  { label: "Deals", icon: "£" },
];

type NavItem = {
  label: string;
  icon: string;
};

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));

  if (safeSeconds < 60) {
    return `${safeSeconds}s`;
  }

  const totalMinutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  if (totalMinutes < 60) {
    return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatSessionDate(unixSeconds: number) {
  if (!unixSeconds) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(unixSeconds * 1000));
}

function PandaMark() {
  return (
    <div className="panda-mark" aria-label="PandaVault">
      <span className="panda-ear panda-ear-left" />
      <span className="panda-ear panda-ear-right" />
      <span className="panda-face">
        <span className="panda-eye panda-eye-left" />
        <span className="panda-eye panda-eye-right" />
        <span className="panda-nose" />
        <span className="panda-pf">PF</span>
      </span>
    </div>
  );
}

function App() {
  const [activeNav, setActiveNav] = useState("Home");
  const [steamScan, setSteamScan] = useState<SteamScanResult | null>(null);
  const [steamError, setSteamError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    invoke<SteamScanResult>("scan_steam_games")
      .then((result) => {
        if (!cancelled) {
          setSteamScan(result);
          setSteamError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSteamScan(null);
          setSteamError(String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadAnalytics = () => {
      invoke<AnalyticsSummary>("get_analytics_summary")
        .then((result) => {
          if (!cancelled) {
            setAnalytics(result);
            setAnalyticsError(null);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setAnalytics(null);
            setAnalyticsError(String(error));
          }
        });
    };

    loadAnalytics();

    const interval = window.setInterval(loadAnalytics, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <PandaMark />

          <div className="brand-copy">
            <div className="brand-name">
              <span>PANDA</span>
              <strong>VAULT</strong>
            </div>
            <div className="brand-product">BY PANDAFORGE SOFTWARE</div>
          </div>
        </div>

        <nav className="nav-list" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`nav-item ${
                activeNav === item.label ? "nav-item-active" : ""
              }`}
              onClick={() => setActiveNav(item.label)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        <div className="system-card">
          <div className="system-card-header">
            <span className="status-dot status-ready" />
            <span>
              {steamError
                ? "Steam scan failed"
                : steamScan
                  ? "Steam connected"
                  : "Scanning Steam"}
            </span>
          </div>
          <p>
            {steamError
              ? steamError
              : steamScan
                ? `${steamScan.games.length} installed Steam games found across ${steamScan.libraryPaths.length} library.`
                : "Reading your local Steam installation..."}
          </p>
        </div>

        <button
          className={`settings-button ${
            activeNav === "Settings" ? "settings-button-active" : ""
          }`}
          type="button"
          onClick={() => setActiveNav("Settings")}
        >
          <span>⚙</span>
          <span>Settings</span>
        </button>

        <div className="sidebar-footer">
          <span>ALPHA</span>
          <span>v0.1.0</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">PANDAVAULT</p>
            <h1>{activeNav}</h1>
          </div>

          <div className="topbar-actions">
            <label className="search-box">
              <span>⌕</span>
              <input
                type="search"
                placeholder="Search your games..."
                aria-label="Search your games"
              />
            </label>

            <button className="icon-button" type="button" aria-label="Notifications">
              ♢
            </button>

            <button className="profile-button" type="button" aria-label="Profile">
              P
            </button>
          </div>
        </header>

        {activeNav === "Settings" ? (
          <GameLibrariesPage />
        ) : activeNav === "Library" ? (
          <LibraryPage
            games={steamScan?.games ?? []}
            loading={!steamScan && !steamError}
            error={steamError}
          />
        ) : (
          <>
            <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">YOUR GAMING CONTROL CENTRE</p>
            <h2>
              Your games.
              <br />
              <span>Ready when you are.</span>
            </h2>
            <p className="hero-description">
              Know what is ready, what changed and what needs your attention
              before you launch.
            </p>
          </div>

          <div className="hero-status">
            <div className="pulse-ring">
              <PandaMark />
            </div>
            <div>
              <strong>{steamScan ? steamScan.games.length : "—"}</strong>
              <span>{steamError ? "scan unavailable" : "games detected"}</span>
            </div>
          </div>
        </section>

        <section className="health-grid" aria-label="Gaming summary">
          <article className="health-card">
            <span className="health-icon ready">▦</span>
            <div>
              <strong>{steamScan?.games.length ?? "—"}</strong>
              <span>Installed games</span>
            </div>
          </article>

          <article className="health-card">
            <span className="health-icon update">◷</span>
            <div>
              <strong>
                {analytics ? formatDuration(analytics.totalSeconds) : "—"}
              </strong>
              <span>Tracked playtime</span>
            </div>
          </article>

          <article className="health-card">
            <span className="health-icon risk">▶</span>
            <div>
              <strong>{analytics?.sessionCount ?? "—"}</strong>
              <span>Play sessions</span>
            </div>
          </article>

          <article className="health-card health-card-forge">
            <span className="health-icon forge">◆</span>
            <div>
              <strong>{analytics?.uniqueGames ?? "—"}</strong>
              <span>Games tracked</span>
            </div>
          </article>
        </section>

        <section className="section-heading">
          <div>
            <p className="eyebrow">YOUR GAMING</p>
            <h3>Gaming activity</h3>
          </div>

          <button
            type="button"
            className="text-button"
            onClick={() => setActiveNav("Library")}
          >
            View library
            <span>→</span>
          </button>
        </section>

        {analyticsError ? (
          <section className="analytics-empty">
            <strong>Analytics unavailable</strong>
            <p>{analyticsError}</p>
          </section>
        ) : !analytics ? (
          <section className="analytics-empty">
            <strong>Loading gaming activity...</strong>
            <p>Reading your local PandaVault play history.</p>
          </section>
        ) : analytics.sessionCount === 0 ? (
          <section className="analytics-empty">
            <strong>No tracked sessions yet</strong>
            <p>
              Launch a Steam game while PandaVault is running and your gaming
              history will appear here automatically.
            </p>
          </section>
        ) : (
          <section className="analytics-layout" aria-label="Gaming activity">
            <article className="analytics-panel">
              <div className="analytics-panel-heading">
                <div>
                  <p className="eyebrow">TOP GAMES</p>
                  <h4>Most played</h4>
                </div>
                <span>{formatDuration(analytics.totalSeconds)} total</span>
              </div>

              <div className="analytics-game-list">
                {analytics.topGames.map((game, index) => (
                  <div className="analytics-game-row" key={game.appId}>
                    <span className="analytics-rank">{index + 1}</span>

                    <div className="analytics-game-copy">
                      <strong>{game.gameName}</strong>
                      <span>
                        {game.sessionCount}{" "}
                        {game.sessionCount === 1 ? "session" : "sessions"}
                      </span>
                    </div>

                    <strong className="analytics-duration">
                      {formatDuration(game.totalSeconds)}
                    </strong>
                  </div>
                ))}
              </div>
            </article>

            <article className="analytics-panel">
              <div className="analytics-panel-heading">
                <div>
                  <p className="eyebrow">RECENT</p>
                  <h4>Play sessions</h4>
                </div>
                <span>{analytics.sessionCount} recorded</span>
              </div>

              <div className="analytics-session-list">
                {analytics.recentSessions.slice(0, 5).map((session) => (
                  <div className="analytics-session-row" key={session.id}>
                    <div className="analytics-game-copy">
                      <strong>{session.gameName}</strong>
                      <span>{formatSessionDate(session.endedAt)}</span>
                    </div>

                    <strong className="analytics-duration">
                      {formatDuration(session.durationSeconds)}
                    </strong>
                  </div>
                ))}
              </div>
            </article>
          </section>
        )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
