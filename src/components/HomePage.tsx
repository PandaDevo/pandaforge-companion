import { useEffect, useMemo, useState } from "react";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import "./HomePage.css";

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

type GameArtwork = {
  appId: string;
  artworkPath: string | null;
};

type HomePageProps = {
  steamScan: SteamScanResult | null;
  steamError: string | null;
  analytics: AnalyticsSummary | null;
  analyticsError: string | null;
  onNavigate: (destination: string) => void;
};

const browserHeroArtwork: Record<string, string> = {
  "4514930":
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/4514930/2c98296e57c59436102a09392d37b71338e27cf6/library_hero.jpg",
  "1267910":
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1267910/library_hero.jpg",
  "1142710":
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1142710/library_hero.jpg",
};

const browserCardArtwork: Record<string, string> = {
  "4514930":
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/4514930/268bb497efc35744f6bc6de482e0cbc1b8eb1760/header.jpg",
  "1267910":
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1267910/header.jpg",
  "1142710":
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1142710/header.jpg",
};

function formatDuration(seconds: number) {
  const totalMinutes = Math.floor(Math.max(0, seconds) / 60);

  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 GB";
  }

  const gigabytes = bytes / 1024 / 1024 / 1024;

  if (gigabytes >= 1024) {
    return `${(gigabytes / 1024).toFixed(1)} TB`;
  }

  return `${gigabytes.toFixed(gigabytes >= 100 ? 0 : 1)} GB`;
}

function formatSteamMinutes(minutes: number | null) {
  if (minutes === null) {
    return "Unknown";
  }

  return formatDuration(minutes * 60);
}

function relativePlayed(timestamp: number) {
  if (!timestamp) {
    return "Not played yet";
  }

  const seconds =
    Math.floor(Date.now() / 1000) - timestamp;

  if (seconds < 3600) {
    return "Just played";
  }

  const hours = Math.floor(seconds / 3600);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);

  if (days === 1) {
    return "Yesterday";
  }

  if (days < 7) {
    return `${days} days ago`;
  }

  return `${Math.floor(days / 7)}w ago`;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export default function HomePage({
  steamScan,
  steamError,
  analytics,
  analyticsError,
  onNavigate,
}: HomePageProps) {
  const games = steamScan?.games ?? [];

  const [artwork, setArtwork] = useState<Record<string, string>>({});
  const [brokenArtwork, setBrokenArtwork] =
    useState<Record<string, boolean>>({});

  const recentGames = useMemo(
    () =>
      [...games]
        .sort((a, b) => b.lastPlayed - a.lastPlayed)
        .slice(0, 3),
    [games],
  );

  const featuredGame =
    recentGames[0] ?? games[0] ?? null;

  const totalStorage = useMemo(
    () =>
      games.reduce(
        (total, game) => total + game.sizeOnDisk,
        0,
      ),
    [games],
  );

  const totalSteamMinutes = useMemo(
    () =>
      games.reduce(
        (total, game) =>
          total + (game.steamPlaytimeMinutes ?? 0),
        0,
      ),
    [games],
  );

  useEffect(() => {
    let cancelled = false;

    async function refreshArtwork() {
      if (games.length === 0) {
        setArtwork({});
        return;
      }

      if (!isTauri()) {
        const nextArtwork: Record<string, string> = {};

        for (const game of games) {
          const url =
            browserCardArtwork[game.appId] ??
            `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appId}/header.jpg`;

          nextArtwork[game.appId] = url;
        }

        if (!cancelled) {
          setArtwork(nextArtwork);
        }

        return;
      }

      if (!steamScan?.steamPath) {
        return;
      }

      try {
        const imported = await invoke<GameArtwork[]>(
          "import_steam_artwork",
          {
            steamPath: steamScan.steamPath,
            appIds: games.map((game) => game.appId),
          },
        );

        const nextArtwork: Record<string, string> = {};

        for (const item of imported) {
          if (item.artworkPath) {
            nextArtwork[item.appId] =
              convertFileSrc(item.artworkPath);
          }
        }

        if (!cancelled) {
          setArtwork(nextArtwork);
        }
      } catch (error) {
        console.error(
          "Unable to load PandaVault Home artwork:",
          error,
        );
      }
    }

    refreshArtwork();

    return () => {
      cancelled = true;
    };
  }, [games, steamScan?.steamPath]);

  const featuredArtwork =
    featuredGame && !brokenArtwork[`hero-${featuredGame.appId}`]
      ? !isTauri()
        ? browserHeroArtwork[featuredGame.appId] ??
          artwork[featuredGame.appId]
        : artwork[featuredGame.appId]
      : null;

  return (
    <div className="pv-home">
      <section className="pv-home-hero">
        {featuredArtwork ? (
          <img
            className="pv-home-hero-art"
            src={featuredArtwork}
            alt=""
            onError={() => {
              if (!featuredGame) return;

              setBrokenArtwork((current) => ({
                ...current,
                [`hero-${featuredGame.appId}`]: true,
              }));
            }}
          />
        ) : null}

        <div className="pv-home-hero-fallback" />
        <div className="pv-home-hero-overlay" />
        <div className="pv-home-hero-lines" />

        <div className="pv-home-hero-content">
          <span className="pv-home-eyebrow">
            {featuredGame
              ? "CONTINUE PLAYING"
              : "WELCOME TO PANDAVAULT"}
          </span>

          <h2>
            {featuredGame?.name ??
              "YOUR GAMING PC. ORGANISED."}
          </h2>

          <p className="pv-home-hero-lead">
            {featuredGame
              ? "Jump back in, or see what else deserves your time."
              : "Play, manage, discover and stay informed from one gaming command centre."}
          </p>

          <div className="pv-home-hero-actions">
            <button
              type="button"
              className="pv-home-primary"
              onClick={() => onNavigate("Library")}
            >
              <span>{"\u25B6"}</span>
              OPEN LIBRARY
            </button>

            <button
              type="button"
              className="pv-home-secondary"
              onClick={() => onNavigate("News")}
            >
              GAMING NEWS
              <span>{"\u2192"}</span>
            </button>
          </div>
        </div>

        {featuredGame ? (
          <div className="pv-home-hero-meta">
            <div>
              <span>LAST PLAYED</span>
              <strong>
                {relativePlayed(featuredGame.lastPlayed)}
              </strong>
            </div>

            <div>
              <span>STEAM PLAYTIME</span>
              <strong>
                {formatSteamMinutes(
                  featuredGame.steamPlaytimeMinutes,
                )}
              </strong>
            </div>

            <div>
              <span>INSTALL SIZE</span>
              <strong>
                {formatBytes(featuredGame.sizeOnDisk)}
              </strong>
            </div>
          </div>
        ) : null}

        <div className="pv-home-hero-bottom">
          <span>PLAY</span>
          <i />
          <span>MANAGE</span>
          <i />
          <span>DISCOVER</span>
          <i />
          <span>STAY INFORMED</span>
        </div>
      </section>

      <section className="pv-home-summary">
        <article>
          <span className="pv-home-summary-icon">{"\u25C6"}</span>
          <div>
            <strong>{games.length}</strong>
            <span>Installed games</span>
          </div>
        </article>

        <article>
          <span className="pv-home-summary-icon">{"\u25A3"}</span>
          <div>
            <strong>{formatBytes(totalStorage)}</strong>
            <span>Library storage</span>
          </div>
        </article>

        <article>
          <span className="pv-home-summary-icon">{"\u25F7"}</span>
          <div>
            <strong>
              {formatDuration(totalSteamMinutes * 60)}
            </strong>
            <span>Steam playtime</span>
          </div>
        </article>

        <article>
          <span className="pv-home-summary-icon">{"\u25A5"}</span>
          <div>
            <strong>{analytics?.sessionCount ?? 0}</strong>
            <span>PandaVault sessions</span>
          </div>
        </article>
      </section>

      <section className="pv-home-section">
        <header className="pv-home-section-heading">
          <div>
            <span className="pv-home-section-kicker">
              YOUR GAMES
            </span>
            <h3>Continue Playing</h3>
          </div>

          <button
            type="button"
            onClick={() => onNavigate("Library")}
          >
            VIEW LIBRARY {"\u2192"}
          </button>
        </header>

        <div className="pv-home-game-grid">
          {recentGames.map((game) => {
            const imageBroken =
              brokenArtwork[`card-${game.appId}`];

            return (
              <button
                type="button"
                className="pv-home-game-card"
                key={game.appId}
                onClick={() => onNavigate("Library")}
              >
                <div className="pv-home-game-image">
                  <div className="pv-home-game-fallback">
                    {initials(game.name)}
                  </div>

                  {artwork[game.appId] && !imageBroken ? (
                    <img
                      src={artwork[game.appId]}
                      alt=""
                      onError={() =>
                        setBrokenArtwork((current) => ({
                          ...current,
                          [`card-${game.appId}`]: true,
                        }))
                      }
                    />
                  ) : null}

                  <span className="pv-home-game-play">
                    {"\u25B6"}
                  </span>
                </div>

                <div className="pv-home-game-info">
                  <div>
                    <strong>{game.name}</strong>
                    <span>
                      {relativePlayed(game.lastPlayed)}
                    </span>
                  </div>

                  <small>
                    {formatSteamMinutes(
                      game.steamPlaytimeMinutes,
                    )}
                  </small>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="pv-home-world">
        <article className="pv-home-feature-panel pv-home-news-panel">
          <div className="pv-home-panel-topline">
            <span>FOR YOU</span>
            <button
              type="button"
              onClick={() => onNavigate("News")}
            >
              OPEN NEWS {"\u2192"}
            </button>
          </div>

          <h3>Your gaming feed is coming to PandaVault.</h3>

          <p>
            News about games you own, updates from developers,
            PC headlines and optional PlayStation, Xbox and
            Nintendo coverage.
          </p>

          <div className="pv-home-platforms">
            <span>PC</span>
            <span>PLAYSTATION</span>
            <span>XBOX</span>
            <span>NINTENDO</span>
          </div>

          <div className="pv-home-news-preview">
            <span>PERSONALISED</span>
            <strong>
              News that understands what you actually play.
            </strong>
          </div>
        </article>

        <article className="pv-home-feature-panel pv-home-health-panel">
          <div className="pv-home-panel-topline">
            <span>GAME HEALTH</span>
            <button
              type="button"
              onClick={() => onNavigate("Game Health")}
            >
              OPEN HEALTH {"\u2192"}
            </button>
          </div>

          <h3>Is your gaming PC ready?</h3>

          <div className="pv-home-health-list">
            <div>
              <span className="pv-home-health-good">
                {"\u2713"}
              </span>

              <p>
                <strong>Steam library</strong>
                <small>
                  {steamError
                    ? "Needs attention"
                    : `${games.length} installed games detected`}
                </small>
              </p>
            </div>

            <div>
              <span className="pv-home-health-good">
                {"\u2713"}
              </span>

              <p>
                <strong>Play tracking</strong>
                <small>
                  {analyticsError
                    ? "Analytics unavailable"
                    : `${analytics?.sessionCount ?? 0} sessions recorded`}
                </small>
              </p>
            </div>

            <div>
              <span className="pv-home-health-next">
                +
              </span>

              <p>
                <strong>Mod & update intelligence</strong>
                <small>
                  Next stage of Game Health
                </small>
              </p>
            </div>

            <div>
              <span className="pv-home-health-next">
                +
              </span>

              <p>
                <strong>Storage intelligence</strong>
                <small>
                  Find space you can reclaim
                </small>
              </p>
            </div>
          </div>
        </article>
      </section>

      <section className="pv-home-section">
        <header className="pv-home-section-heading">
          <div>
            <span className="pv-home-section-kicker">
              THE CONTROL CENTRE
            </span>
            <h3>Everything Around Your Games</h3>
          </div>
        </header>

        <div className="pv-home-capabilities">
          <button
            type="button"
            onClick={() => onNavigate("News")}
          >
            <span className="pv-home-capability-symbol">
              {"\u2630"}
            </span>
            <small>PERSONALISED</small>
            <strong>Gaming News</strong>
            <p>
              PC first, with the console coverage you choose.
            </p>
            <em>IN DEVELOPMENT</em>
          </button>

          <button
            type="button"
            onClick={() => onNavigate("Game Health")}
          >
            <span className="pv-home-capability-symbol">
              {"\u2713"}
            </span>
            <small>KEEP IT READY</small>
            <strong>Game Health</strong>
            <p>
              Updates, mods, storage, saves and game readiness.
            </p>
            <em>BUILDING NOW</em>
          </button>

          <button
            type="button"
            onClick={() => onNavigate("Deals")}
          >
            <span className="pv-home-capability-symbol">
              {"\u00A3"}
            </span>
            <small>SPEND SMARTER</small>
            <strong>Deals & Wishlist</strong>
            <p>
              Discover discounts that actually matter to you.
            </p>
            <em>PLANNED</em>
          </button>

          <button
            type="button"
            onClick={() => onNavigate("Mods")}
          >
            <span className="pv-home-capability-symbol">
              {"\u25C6"}
            </span>
            <small>CONTROL YOUR SETUP</small>
            <strong>Mods</strong>
            <p>
              One place for installed mods and health checks.
            </p>
            <em>PLANNED</em>
          </button>
        </div>
      </section>

      <section className="pv-home-social">
        <div>
          <span className="pv-home-section-kicker">
            SOCIAL WITHOUT REPLACING DISCORD
          </span>

          <h3>Know what your gaming world is doing.</h3>

          <p>
            PandaVault will complement Discord rather than
            compete with it — games, activity and useful social
            context alongside the tools that manage your PC.
          </p>
        </div>

        <div className="pv-home-social-card">
          <span>DISCORD COMPANION</span>
          <strong>Friends Playing</strong>
          <p>
            Integration will be added only through supported
            Discord APIs.
          </p>
          <em>FUTURE INTEGRATION</em>
        </div>
      </section>

      <footer className="pv-home-footer-v3">
        <div>
          <span>PANDAVAULT</span>
          <strong>YOUR GAMING PC. ORGANISED.</strong>
        </div>

        <p>
          PLAY
          <i />
          MANAGE
          <i />
          DISCOVER
          <i />
          STAY INFORMED
        </p>
      </footer>
    </div>
  );
}