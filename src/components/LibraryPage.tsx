import { useEffect, useMemo, useState } from "react";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";

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
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [runningGames, setRunningGames] = useState<RunningGame[]>([]);
  const [runningError, setRunningError] = useState<string | null>(null);
  const [artworkByAppId, setArtworkByAppId] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    async function refreshArtwork() {
      if (!isTauri() || !steamPath || games.length === 0) {
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
      } catch (error) {
        if (!cancelled) {
          setRunningGames([]);
          setRunningError(String(error));
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

  const runningAppIds = useMemo(
    () => new Set(runningGames.map((game) => game.appId)),
    [runningGames],
  );

  return (
    <section className="pv-library">
      <header className="pv-library-hero">
        <div className="pv-library-heading">
          <p className="pv-library-eyebrow">YOUR GAME COLLECTION</p>
          <h1>Library</h1>
          <p className="pv-library-intro">
            Your installed games, ready to play.
          </p>
        </div>

        <div className="pv-library-overview">
          <div className="pv-library-overview-item">
            <span>GAMES</span>
            <strong>{games.length}</strong>
          </div>

          <div className="pv-library-overview-divider" />

          <div className="pv-library-overview-item">
            <span>INSTALLED</span>
            <strong>{formatBytes(totalSize)}</strong>
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
        <div className="pv-library-tabs" aria-label="Library filters">
          <button type="button" className="pv-library-tab active">
            ALL GAMES
            <span>{games.length}</span>
          </button>

          <button type="button" className="pv-library-tab">
            INSTALLED
          </button>

          <button type="button" className="pv-library-tab">
            FAVOURITES
          </button>
        </div>

        <div className="pv-library-actions">
          <label className="pv-library-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search your games..."
              aria-label="Search library"
            />
          </label>

          <label className="pv-library-sort">
            <span>SORT</span>
            <select
              value={sortMode}
              onChange={(event) =>
                setSortMode(event.currentTarget.value as SortMode)
              }
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
              : "Try a different game name or App ID."}
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
                      title="Favourite"
                      aria-label={`Favourite ${game.name}`}
                    >
                      ☆
                    </button>

                    <button
                      type="button"
                      className="pv-icon-button"
                      title="More options"
                      aria-label={`More options for ${game.name}`}
                    >
                      •••
                    </button>
                  </div>
                </div>

                <div className="pv-game-content">
                  <div className="pv-game-title">
                    <div>
                      <span className="pv-game-appid">
                        APP {game.appId}
                      </span>
                      <h2>{game.name}</h2>
                    </div>
                  </div>

                  <div className="pv-game-stats">
                    <div>
                      <span>PLAYTIME</span>
                      <strong>
                        {formatSteamPlaytime(game.steamPlaytimeMinutes)}
                      </strong>
                    </div>

                    <div>
                      <span>SIZE</span>
                      <strong>{formatBytes(game.sizeOnDisk)}</strong>
                    </div>

                    <div>
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
                      disabled={isRunning}
                    >
                      <span className="pv-play-symbol">
                        {isRunning ? "●" : "▶"}
                      </span>
                      {isRunning ? "RUNNING" : "PLAY"}
                    </button>

                    <span className="pv-installed-status">
                      <span />
                      INSTALLED
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