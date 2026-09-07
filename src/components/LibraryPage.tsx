import { useEffect, useMemo, useState } from "react";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import {
  Clock3,
  Gamepad2,
  HardDrive,
  MoreHorizontal,
  Play,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import "./LibraryPage.css";

export type LibrarySteamGame = {
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

type GameArtwork = {
  appId: string;
  artworkPath: string | null;
};

const browserLibraryArtwork: Record<string, string> = {
  "4514930":
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/4514930/268bb497efc35744f6bc6de482e0cbc1b8eb1760/header.jpg",
  "1267910":
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1267910/header.jpg",
  "1142710":
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1142710/header.jpg",
};

function browserArtworkForGame(appId: string) {
  return (
    browserLibraryArtwork[appId] ??
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`
  );
}
type LaunchResult = {
  source: string;
  gameId: string;
  launched: boolean;
};
type RunningGame = {
  appId: string;
  name: string;
  installPath: string;
  executablePath: string;
};

type LibraryPageProps = {
  games: LibrarySteamGame[];
  steamPath: string | null;
  loading: boolean;
  error: string | null;
};

type SortMode = "name" | "recent" | "size";

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "Unknown";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const decimals = unitIndex >= 3 ? 1 : 0;

  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatSteamDate(timestamp: number) {
  if (!timestamp) {
    return "Never";
  }

  const date = new Date(timestamp * 1000);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatSteamPlaytime(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0) {
    return "Unknown";
  }

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainingMinutes}m`;
}

function gameInitials(name: string) {
  const words = name
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);

  if (words.length === 0) {
    return "PF";
  }

  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export default function LibraryPage({
  games,
  steamPath,
  loading,
  error,
}: LibraryPageProps) {
  const [query, setQuery] = useState("");
  const [launchingAppId, setLaunchingAppId] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [runningGames, setRunningGames] = useState<RunningGame[]>([]);
  const [runningError, setRunningError] = useState<string | null>(null);
  const [artworkByAppId, setArtworkByAppId] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    async function refreshArtwork() {
      if (games.length === 0) {
        if (!cancelled) {
          setArtworkByAppId({});
        }

        return;
      }

      if (!isTauri()) {
        const nextArtwork: Record<string, string> = {};

        for (const game of games) {
          nextArtwork[game.appId] = browserArtworkForGame(game.appId);
        }

        if (!cancelled) {
          setArtworkByAppId(nextArtwork);
        }

        return;
      }

      if (!steamPath) {
        if (!cancelled) {
          setArtworkByAppId({});
        }

        return;
      }

      try {
        const result = await invoke<GameArtwork[]>("import_steam_artwork", {
          steamPath,
          appIds: games.map((game) => game.appId),
        });

        if (cancelled) {
          return;
        }

        const nextArtwork: Record<string, string> = {};

        for (const item of result) {
          if (item.artworkPath) {
            nextArtwork[item.appId] = convertFileSrc(item.artworkPath);
          }
        }

        setArtworkByAppId(nextArtwork);
      } catch (artworkError) {
        console.error("Unable to import local Steam artwork:", artworkError);

        if (!cancelled) {
          setArtworkByAppId({});
        }
      }
    }

    refreshArtwork();

    return () => {
      cancelled = true;
    };
  }, [games, steamPath]);

  useEffect(() => {
    let cancelled = false;

    async function refreshRunningGames() {
      if (!isTauri() || games.length === 0) {
        if (!cancelled) {
          setRunningGames([]);
          setRunningError(null);
        }

        return;
      }

      try {
        const result = await invoke<RunningGame[]>("detect_running_games", {
          games,
        });

        if (!cancelled) {
          setRunningGames(result);
          setRunningError(null);
        }
      } catch (runtimeError) {
        if (!cancelled) {
          setRunningGames([]);
          setRunningError(String(runtimeError));
        }
      }
    }

    refreshRunningGames();

    const interval = window.setInterval(refreshRunningGames, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [games]);

  async function launchGame(game: LibrarySteamGame) {
    if (runningAppIds.has(game.appId) || launchingAppId !== null) {
      return;
    }

    setLaunchError(null);

    if (!isTauri()) {
      setLaunchError(
        "Game launching is available in the PandaVault desktop app."
      );
      return;
    }

    setLaunchingAppId(game.appId);

    try {
      const result = await invoke<LaunchResult>("launch_game", {
        source: "steam",
        gameId: game.appId,
      });

      if (!result.launched) {
        throw new Error(`PandaVault could not launch ${game.name}.`);
      }
    } catch (launchFailure) {
      console.error(`Unable to launch ${game.name}:`, launchFailure);

      setLaunchError(
        launchFailure instanceof Error
          ? launchFailure.message
          : String(launchFailure)
      );
    } finally {
      setLaunchingAppId(null);
    }
  }
  const visibleGames = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    const filtered = games.filter((game) => {
      if (!normalizedQuery) {
        return true;
      }

      return [
        game.name,
        game.appId,
        game.installPath,
        game.installDir,
      ].some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery),
      );
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === "recent") {
        return b.lastPlayed - a.lastPlayed;
      }

      if (sortMode === "size") {
        return b.sizeOnDisk - a.sizeOnDisk;
      }

      return a.name.localeCompare(b.name);
    });
  }, [games, query, sortMode]);

  const totalSize = useMemo(
    () => games.reduce((total, game) => total + game.sizeOnDisk, 0),
    [games],
  );

  const totalPlaytime = useMemo(
    () =>
      games.reduce(
        (total, game) =>
          total + (game.steamPlaytimeMinutes ?? 0),
        0,
      ),
    [games],
  );

  const runningAppIds = useMemo(
    () => new Set(runningGames.map((game) => game.appId)),
    [runningGames],
  );

  return (
    <section className="pv-library pv-library-v4">
      <header className="pv-library-hero">
        <div className="pv-library-heading">
          <div className="pv-library-kicker">
            <span className="pv-library-kicker-icon">
              <Gamepad2 size={14} aria-hidden="true" />
            </span>
            YOUR GAME COLLECTION
          </div>

          <h1>Library</h1>

          <p className="pv-library-intro">
            Everything installed on your gaming PC, organised in one place.
          </p>
        </div>

        <div className="pv-library-overview">
          <div className="pv-library-overview-item">
            <span>GAMES</span>
            <strong>{games.length}</strong>
          </div>

          <div className="pv-library-overview-divider" />

          <div className="pv-library-overview-item">
            <span>STORAGE</span>
            <strong>{formatBytes(totalSize)}</strong>
          </div>

          <div className="pv-library-overview-divider" />

          <div className="pv-library-overview-item">
            <span>PLAYTIME</span>
            <strong>{formatSteamPlaytime(totalPlaytime)}</strong>
          </div>

          <div className="pv-library-overview-divider" />

          <div className="pv-library-overview-item">
            <span>RUNNING</span>
            <strong className={runningGames.length > 0 ? "is-live" : ""}>
              {runningGames.length}
            </strong>
          </div>
        </div>
      </header>

      <div className="pv-library-toolbar">
        <div className="pv-library-view">
          <div className="pv-library-view-title">
            <span>INSTALLED GAMES</span>
            <strong>{visibleGames.length}</strong>
          </div>

          <span className="pv-library-view-note">
            Steam library
          </span>
        </div>

        <div className="pv-library-actions">
          <label className="pv-library-search">
            <Search size={16} aria-hidden="true" />

            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search your library"
              aria-label="Search library"
            />

            {query && (
              <button
                type="button"
                className="pv-library-search-clear"
                onClick={() => setQuery("")}
                aria-label="Clear library search"
              >
                CLEAR
              </button>
            )}
          </label>

          <label className="pv-library-sort">
            <SlidersHorizontal size={14} aria-hidden="true" />
            <span>SORT</span>

            <select
              value={sortMode}
              onChange={(event) =>
                setSortMode(event.currentTarget.value as SortMode)
              }
              aria-label="Sort library"
            >
              <option value="name">Name</option>
              <option value="recent">Recently played</option>
              <option value="size">Installed size</option>
            </select>
          </label>
        </div>
      </div>

      {loading && (
        <div className="library-state-card">
          <strong>Scanning Steam...</strong>
          <span>Reading your local installed games.</span>
        </div>
      )}

      {error && (
        <div className="library-state-card library-state-error">
          <strong>Steam scan unavailable</strong>
          <span>{error}</span>
        </div>
      )}

      {launchError && (
        <div className="library-launch-warning" role="alert">
          <strong>Unable to launch game</strong>
          <span>{launchError}</span>
          <button
            type="button"
            onClick={() => setLaunchError(null)}
          >
            DISMISS
          </button>
        </div>
      )}
      {runningError && !error && (
        <div className="library-runtime-warning">
          <strong>Live game detection unavailable</strong>
          <span>{runningError}</span>
        </div>
      )}

      {!loading && !error && visibleGames.length === 0 && (
        <div className="library-state-card">
          <strong>
            {games.length === 0
              ? "No installed Steam games detected"
              : "No games match your search"}
          </strong>

          <span>
            {games.length === 0
              ? "Add or scan game libraries from Settings."
              : "Try another game name or App ID."}
          </span>
        </div>
      )}

      {!loading && !error && visibleGames.length > 0 && (
        <div className="pv-game-grid">
          {visibleGames.map((game) => {
            const isRunning = runningAppIds.has(game.appId);

            return (
              <article
                className={`pv-game-card${isRunning ? " is-running" : ""}`}
                key={game.appId}
              >
                <div className="pv-game-cover">
                  {artworkByAppId[game.appId] ? (
                    <img
                      src={artworkByAppId[game.appId]}
                      alt={`${game.name} cover`}
                      onError={(event) => {
                        event.currentTarget.style.display = "none";

                        const fallback =
                          event.currentTarget.nextElementSibling;

                        if (fallback instanceof HTMLElement) {
                          fallback.style.display = "grid";
                        }
                      }}
                    />
                  ) : null}

                  <div
                    className="pv-game-cover-fallback"
                    style={{
                      display: artworkByAppId[game.appId]
                        ? "none"
                        : "grid",
                    }}
                  >
                    <strong>{gameInitials(game.name)}</strong>
                  </div>

                  <div className="pv-game-cover-shade" />

                  <div className="pv-game-cover-top">
                    <span className="pv-steam-badge">STEAM</span>

                    {isRunning && (
                      <span className="pv-running-badge">
                        <span />
                        RUNNING
                      </span>
                    )}
                  </div>

                  <div className="pv-game-cover-actions">
                    <button
                      type="button"
                      className="pv-icon-button"
                      title="Game options coming later"
                      aria-label={`Options for ${game.name}`}
                      disabled
                    >
                      <MoreHorizontal size={17} aria-hidden="true" />
                    </button>
                  </div>

                  <div className="pv-game-cover-playtime">
                    <Clock3 size={12} aria-hidden="true" />
                    {formatSteamPlaytime(game.steamPlaytimeMinutes)}
                  </div>
                </div>

                <div className="pv-game-content">
                  <div className="pv-game-title">
<h2 title={game.name}>{game.name}</h2>
                  </div>

                  <div className="pv-game-stats">
                    <div>
                      <HardDrive size={13} aria-hidden="true" />
                      <span>SIZE</span>
                      <strong>{formatBytes(game.sizeOnDisk)}</strong>
                    </div>

                    <div>
                      <Clock3 size={13} aria-hidden="true" />
                      <span>LAST PLAYED</span>
                      <strong>{formatSteamDate(game.lastPlayed)}</strong>
                    </div>
                  </div>

                  <div className="pv-game-footer">
                    <button
                      type="button"
                      className={`pv-play-button${
                        isRunning ? " is-running" : ""
                      }`}
                      onClick={() => launchGame(game)}
                      disabled={isRunning || launchingAppId !== null}
                      title={
                        isRunning
                          ? `${game.name} is currently running`
                          : launchingAppId === game.appId
                            ? `Launching ${game.name}`
                            : `Launch ${game.name}`
                      }
                    >
                      <Play size={13} fill="currentColor" aria-hidden="true" />
                      {isRunning
                        ? "RUNNING"
                        : launchingAppId === game.appId
                          ? "LAUNCHING..."
                          : "PLAY"}
                    </button>

                    <span
                      className="pv-installed-status"
                      aria-label="Installed through Steam"
                    >
                      <span className="pv-source-dot" />
                      <strong>STEAM</strong>
                      <span className="pv-source-separator">·</span>
                      <span>INSTALLED</span>
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}