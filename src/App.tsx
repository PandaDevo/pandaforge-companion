import { useEffect, useState } from "react";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Gamepad2,
  HeartPulse,
  Home,
  Library,
  Menu,
  Newspaper,
  PackageOpen,
  Search,
  Settings,
  Sparkles,
  Tag,
} from "lucide-react";
import pandaVaultEmblem from "./assets/PandaVault Logo Blank.png";
import { invoke, isTauri } from "@tauri-apps/api/core";
import GameLibrariesPage from "./components/GameLibrariesPage";
import LibraryPage from "./components/LibraryPage";
import HomePage from "./components/HomePage";
import FeaturePreviewPage from "./components/FeaturePreviewPage";
import "./App.css";
import "./Shell.css";

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
const browserDevGames: SteamGame[] = [
  {
    appId: "1267910",
    name: "Melvor Idle",
    installDir: "Melvor Idle",
    installPath: "",
    libraryPath: "",
    sizeOnDisk: 1450000000,
    buildId: "dev",
    stateFlags: 4,
    lastUpdated: 0,
    lastPlayed: Math.floor(Date.now() / 1000) - 86400,
    steamPlaytimeMinutes: 1255,
    steamPlaytime2weeksMinutes: 180,
  },
  {
    appId: "4514930",
    name: "The Undercut",
    installDir: "The Undercut",
    installPath: "",
    libraryPath: "",
    sizeOnDisk: 4200000000,
    buildId: "dev",
    stateFlags: 4,
    lastUpdated: 0,
    lastPlayed: Math.floor(Date.now() / 1000) - 3600,
    steamPlaytimeMinutes: 486,
    steamPlaytime2weeksMinutes: 486,
  },
  {
    appId: "1142710",
    name: "Total War: WARHAMMER III",
    installDir: "Total War WARHAMMER III",
    installPath: "",
    libraryPath: "",
    sizeOnDisk: 86000000000,
    buildId: "dev",
    stateFlags: 4,
    lastUpdated: 0,
    lastPlayed: Math.floor(Date.now() / 1000) - 172800,
    steamPlaytimeMinutes: 49,
    steamPlaytime2weeksMinutes: 0,
  },
];

const browserDevSteamScan: SteamScanResult = {
  steamPath: "",
  libraryPaths: [],
  games: browserDevGames,
};

const browserDevAnalytics: AnalyticsSummary = {
  totalSeconds: 54600,
  sessionCount: 8,
  uniqueGames: 3,
  topGames: [
    {
      appId: "4514930",
      gameName: "The Undercut",
      totalSeconds: 25200,
      sessionCount: 3,
    },
    {
      appId: "1267910",
      gameName: "Melvor Idle",
      totalSeconds: 19800,
      sessionCount: 3,
    },
    {
      appId: "1142710",
      gameName: "Total War: WARHAMMER III",
      totalSeconds: 9600,
      sessionCount: 2,
    },
  ],
  recentSessions: [],
};

type NavIconName =
  | "home"
  | "library"
  | "health"
  | "mods"
  | "news"
  | "deals";

type NavItem = {
  label: string;
  icon: NavIconName;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    label: "PLAY",
    items: [
      { label: "Home", icon: "home" },
      { label: "Library", icon: "library" },
    ],
  },
  {
    label: "YOUR PC",
    items: [
      { label: "Game Health", icon: "health" },
      { label: "Mods", icon: "mods" },
    ],
  },
  {
    label: "DISCOVER",
    items: [
      { label: "News", icon: "news" },
      { label: "Deals", icon: "deals" },
    ],
  },
];

function NavIcon({ name }: { name: NavIconName }) {
  const props = {
    size: 19,
    strokeWidth: 1.9,
    "aria-hidden": true,
  };

  switch (name) {
    case "home":
      return <Home {...props} />;
    case "library":
      return <Library {...props} />;
    case "health":
      return <HeartPulse {...props} />;
    case "mods":
      return <PackageOpen {...props} />;
    case "news":
      return <Newspaper {...props} />;
    case "deals":
      return <Tag {...props} />;
  }
}





function PandaMark() {
  return (
    <div className="panda-mark" aria-label="PandaVault">
      <span className="panda-mark-glow" aria-hidden="true" />
      <img src={pandaVaultEmblem} alt="" />
    </div>
  );
}

function App() {
  const [activeNav, setActiveNav] = useState("Home");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [steamScan, setSteamScan] = useState<SteamScanResult | null>(null);
  const [steamError, setSteamError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!isTauri()) {
      setSteamScan(browserDevSteamScan);
      setSteamError(null);

      return () => {
        cancelled = true;
      };
    }

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

    if (!isTauri()) {
      setAnalytics(browserDevAnalytics);
      setAnalyticsError(null);

      return () => {
        cancelled = true;
      };
    }

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
    <div className={`app-shell ${sidebarCollapsed ? "app-shell-collapsed" : ""}`}>
      <aside
        className={`sidebar ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
        aria-label="PandaVault navigation"
      >
        <div className="brand">
          <PandaMark />

          <div className="brand-copy">
            <div className="brand-name">
              <span>PANDA</span>
              <strong>VAULT</strong>
            </div>
            <div className="brand-product">BY PANDAFORGE SOFTWARE</div>
          </div>

          <button
            className="sidebar-collapse-button"
            type="button"
            onClick={() => setSidebarCollapsed((value) => !value)}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? (
              <ChevronRight size={17} aria-hidden="true" />
            ) : (
              <ChevronLeft size={17} aria-hidden="true" />
            )}
          </button>
        </div>

        <nav className="nav-list" aria-label="Main navigation">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>

              <div className="nav-group-items">
                {group.items.map((item) => {
                  const active = activeNav === item.label;

                  return (
                    <button
                      key={item.label}
                      type="button"
                      className={`nav-item ${active ? "nav-item-active" : ""}`}
                      onClick={() => setActiveNav(item.label)}
                      aria-current={active ? "page" : undefined}
                      aria-label={sidebarCollapsed ? item.label : undefined}
                      title={sidebarCollapsed ? item.label : undefined}
                    >
                      <span className="nav-icon">
                        <NavIcon name={item.icon} />
                      </span>
                      <span className="nav-label">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        <div
          className={`system-card ${
            steamError
              ? "system-card-error"
              : steamScan
                ? "system-card-ready"
                : "system-card-scanning"
          }`}
          title={
            steamError
              ? steamError
              : steamScan
                ? `${steamScan.games.length} installed Steam games`
                : "Scanning local Steam library"
          }
        >
          <div className="system-card-icon">
            <Gamepad2 size={18} aria-hidden="true" />
            <span
              className={`status-dot ${
                steamError ? "status-error" : "status-ready"
              }`}
            />
          </div>

          <div className="system-card-copy">
            <strong>
              {steamError
                ? "Steam unavailable"
                : steamScan
                  ? "Steam connected"
                  : "Scanning Steam"}
            </strong>
            <span>
              {steamError
                ? "Check library settings"
                : steamScan
                  ? `${steamScan.games.length} games detected`
                  : "Reading local library"}
            </span>
          </div>
        </div>

        <button
          className={`settings-button ${
            activeNav === "Settings" ? "settings-button-active" : ""
          }`}
          type="button"
          onClick={() => setActiveNav("Settings")}
          aria-current={activeNav === "Settings" ? "page" : undefined}
          aria-label={sidebarCollapsed ? "Settings" : undefined}
          title={sidebarCollapsed ? "Settings" : undefined}
        >
          <Settings size={19} strokeWidth={1.9} aria-hidden="true" />
          <span className="settings-label">Settings</span>
        </button>

        <div className="sidebar-footer">
          <span>ALPHA</span>
          <span>v0.1.0</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-heading">
            <button
              className="topbar-menu-button"
              type="button"
              onClick={() => setSidebarCollapsed((value) => !value)}
              aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
              title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
            >
              <Menu size={20} aria-hidden="true" />
            </button>

            <div className="topbar-page">
              <p className="eyebrow">
                <Sparkles size={12} aria-hidden="true" />
                YOUR GAMING CONTROL CENTRE
              </p>

              <div className="topbar-title-row">
                <h1>{activeNav}</h1>
                <span className="topbar-title-accent" aria-hidden="true" />
              </div>
            </div>
          </div>

          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} aria-hidden="true" />

              <input
                type="search"
                placeholder="Search games, news and more"
                aria-label="Search PandaVault"
              />

              <kbd>Ctrl K</kbd>
            </label>

            <span className="topbar-divider" aria-hidden="true" />

            <button
              className="icon-button"
              type="button"
              aria-label="Notifications"
              title="Notifications"
            >
              <Bell size={18} aria-hidden="true" />
            </button>

            <button
              className="profile-button"
              type="button"
              aria-label="PandaVault profile"
              title="Profile"
            >
              <CircleUserRound size={19} aria-hidden="true" />
            </button>
          </div>
        </header>

        {activeNav === "Settings" ? (
          <GameLibrariesPage />
        ) : activeNav === "Library" ? (
          <LibraryPage
            games={steamScan?.games ?? []}
            steamPath={steamScan?.steamPath ?? null}
            loading={!steamScan && !steamError}
            error={steamError}
          />
        ) : activeNav === "Home" ? (
          <HomePage
            steamScan={steamScan}
            steamError={steamError}
            analytics={analytics}
            analyticsError={analyticsError}
            onNavigate={setActiveNav}
          />
        ) : (
          <FeaturePreviewPage
            feature={activeNav}
            onNavigate={setActiveNav}
          />
        )}
      </main>
    </div>
  );
}

export default App;
