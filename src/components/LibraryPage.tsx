import { useMemo, useState } from "react";

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
};

type LibraryPageProps = {
  games: LibrarySteamGame[];
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
  loading,
  error,
}: LibraryPageProps) {
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("name");

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

  return (
    <section className="library-page">
      <div className="library-page-heading">
        <div>
          <p className="eyebrow">YOUR INSTALLED GAMES</p>
          <h2>Library</h2>
          <p>
            Real games detected from your local Steam installation. Nothing
            here is placeholder data.
          </p>
        </div>

        <div className="library-count-card">
          <strong>{games.length}</strong>
          <span>Installed games</span>
        </div>
      </div>

      <div className="library-summary-grid">
        <article>
          <span>Games detected</span>
          <strong>{games.length}</strong>
        </article>

        <article>
          <span>Total installed size</span>
          <strong>{formatBytes(totalSize)}</strong>
        </article>

        <article>
          <span>Platform</span>
          <strong>Steam</strong>
        </article>
      </div>

      <div className="library-controls">
        <label className="library-search">
          <span>⌕</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search name, App ID or install path..."
            aria-label="Search library"
          />
        </label>

        <label className="library-sort">
          <span>Sort</span>
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
              : "Try a different game name, App ID or path."}
          </span>
        </div>
      )}

      {!loading && !error && visibleGames.length > 0 && (
        <div className="real-game-list">
          {visibleGames.map((game) => (
            <article className="real-game-card" key={game.appId}>
              <div className="real-game-mark">
                {gameInitials(game.name)}
              </div>

              <div className="real-game-main">
                <div className="real-game-title-row">
                  <div>
                    <span className="real-game-platform">STEAM</span>
                    <h3>{game.name}</h3>
                  </div>

                  <span className="real-game-appid">
                    APP {game.appId}
                  </span>
                </div>

                <div className="real-game-meta-grid">
                  <div>
                    <span>Installed size</span>
                    <strong>{formatBytes(game.sizeOnDisk)}</strong>
                  </div>

                  <div>
                    <span>Last played</span>
                    <strong>{formatSteamDate(game.lastPlayed)}</strong>
                  </div>

                  <div>
                    <span>Last updated</span>
                    <strong>{formatSteamDate(game.lastUpdated)}</strong>
                  </div>

                  <div>
                    <span>Build</span>
                    <strong>{game.buildId || "Unknown"}</strong>
                  </div>
                </div>

                <div className="real-game-path">
                  <span>INSTALL PATH</span>
                  <code title={game.installPath}>
                    {game.installPath}
                  </code>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}