import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import GameLibrariesPage from "./components/GameLibrariesPage";
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
};

type SteamScanResult = {
  steamPath: string;
  libraryPaths: string[];
  games: SteamGame[];
};

type NavItem = {
  label: string;
  icon: string;
};

type GameStatus = "ready" | "update" | "risk";

type Game = {
  title: string;
  subtitle: string;
  status: GameStatus;
  statusLabel: string;
  meta: string;
  action: string;
  accent: string;
};

const navItems: NavItem[] = [
  { label: "Home", icon: "⌂" },
  { label: "Library", icon: "▦" },
  { label: "Game Health", icon: "✓" },
  { label: "Mods", icon: "◆" },
  { label: "Updates", icon: "↻" },
  { label: "Deals", icon: "£" },
];

const games: Game[] = [
  {
    title: "Cyberpunk 2077",
    subtitle: "Steam",
    status: "ready",
    statusLabel: "Ready to play",
    meta: "New update since you last played",
    action: "What changed?",
    accent: "cyberpunk",
  },
  {
    title: "7 Days to Die",
    subtitle: "Steam",
    status: "risk",
    statusLabel: "Mod risk detected",
    meta: "31 mods installed · 6 potentially affected",
    action: "Check mod health",
    accent: "seven-days",
  },
  {
    title: "Hell Let Loose",
    subtitle: "Steam",
    status: "update",
    statusLabel: "Update available",
    meta: "Last played 3 days ago",
    action: "View update",
    accent: "hell-let-loose",
  },
];

function PandaMark() {
  return (
    <div className="panda-mark" aria-label="PandaForge">
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <PandaMark />

          <div className="brand-copy">
            <div className="brand-name">
              <span>PANDA</span>
              <strong>FORGE</strong>
            </div>
            <div className="brand-product">COMPANION</div>
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
            <p className="eyebrow">PANDAFORGE COMPANION</p>
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

        <section className="health-grid" aria-label="Game health summary">
          <article className="health-card">
            <span className="health-icon ready">✓</span>
            <div>
              <strong>22</strong>
              <span>Ready to play</span>
            </div>
          </article>

          <article className="health-card">
            <span className="health-icon update">↻</span>
            <div>
              <strong>3</strong>
              <span>Updates available</span>
            </div>
          </article>

          <article className="health-card">
            <span className="health-icon risk">!</span>
            <div>
              <strong>2</strong>
              <span>Need attention</span>
            </div>
          </article>

          <article className="health-card health-card-forge">
            <span className="health-icon forge">⚡</span>
            <div>
              <strong>4</strong>
              <span>Changes since played</span>
            </div>
          </article>
        </section>

        <section className="section-heading">
          <div>
            <p className="eyebrow">YOUR GAMES</p>
            <h3>Needs your attention</h3>
          </div>

          <button type="button" className="text-button">
            View library
            <span>→</span>
          </button>
        </section>

        <section className="game-grid">
          {games.map((game) => (
            <article key={game.title} className={`game-card ${game.accent}`}>
              <div className="game-art">
                <div className="game-art-shade" />

                <div className="game-card-top">
                  <span className={`game-status game-status-${game.status}`}>
                    <span className="status-dot" />
                    {game.statusLabel}
                  </span>

                  <button type="button" className="more-button" aria-label="More options">
                    •••
                  </button>
                </div>

                <div className="game-title">
                  <span>{game.subtitle}</span>
                  <h4>{game.title}</h4>
                </div>
              </div>

              <div className="game-details">
                <p>{game.meta}</p>

                <div className="game-actions">
                  <button type="button" className="secondary-button">
                    {game.action}
                  </button>
                  <button type="button" className="play-button">
                    Play
                    <span>▶</span>
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
