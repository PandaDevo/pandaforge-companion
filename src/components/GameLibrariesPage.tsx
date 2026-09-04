import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { load } from "@tauri-apps/plugin-store";

type LibraryLocation = {
  path: string;
  addedAt: number;
};

type ScannedSteamGame = {
  appId: string;
  name: string;
  installPath: string;
  libraryPath: string;
};

type ApprovedLibraryScanResult = {
  approvedPaths: string[];
  steamLibraryPaths: string[];
  games: ScannedSteamGame[];
  warnings: string[];
};

const STORE_FILE = "pandaforge-settings.json";
const STORE_KEY = "gameLibraries";

function normalizeLibraryPath(value: string) {
  const normalized = value.trim().replace(/\//g, "\\");

  if (/^[A-Za-z]:\\$/.test(normalized)) {
    return normalized;
  }

  return normalized.replace(/\\+$/, "");
}

function pathIdentity(value: string) {
  return normalizeLibraryPath(value).toLocaleLowerCase();
}

export default function GameLibrariesPage() {
  const [libraries, setLibraries] = useState<LibraryLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] =
    useState<ApprovedLibraryScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadLibraries() {
      try {
        const store = await load(STORE_FILE, { autoSave: false });
        const saved = await store.get<LibraryLocation[]>(STORE_KEY);

        if (!cancelled) {
          setLibraries(Array.isArray(saved) ? saved : []);
          setStorageError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setStorageError(String(error));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadLibraries();

    return () => {
      cancelled = true;
    };
  }, []);

  async function persistLibraries(next: LibraryLocation[]) {
    const store = await load(STORE_FILE, { autoSave: false });

    await store.set(STORE_KEY, next);
    await store.save();

    setLibraries(next);
    setStorageError(null);
  }

  async function addLibraries() {
    if (adding) {
      return;
    }

    setAdding(true);

    try {
      const selected = await open({
        directory: true,
        multiple: true,
        title: "Add game libraries",
      });

      if (!selected) {
        return;
      }

      const selectedPaths = Array.isArray(selected) ? selected : [selected];
      const existing = new Set(libraries.map((item) => pathIdentity(item.path)));
      const now = Date.now();

      const additions = selectedPaths
        .map(normalizeLibraryPath)
        .filter((path) => {
          const identity = pathIdentity(path);

          if (!path || existing.has(identity)) {
            return false;
          }

          existing.add(identity);
          return true;
        })
        .map((path, index) => ({
          path,
          addedAt: now + index,
        }));

      if (additions.length === 0) {
        return;
      }

      await persistLibraries([...libraries, ...additions]);
    } catch (error) {
      setStorageError(String(error));
    } finally {
      setAdding(false);
    }
  }

  async function removeLibrary(path: string) {
    try {
      const identity = pathIdentity(path);

      await persistLibraries(
        libraries.filter((library) => pathIdentity(library.path) !== identity),
      );

      setScanResult(null);
      setScanError(null);
    } catch (error) {
      setStorageError(String(error));
    }
  }

  async function scanLibraries() {
    if (libraries.length === 0 || scanning) {
      return;
    }

    setScanning(true);
    setScanError(null);

    try {
      const result = await invoke<ApprovedLibraryScanResult>(
        "scan_approved_libraries",
        {
          paths: libraries.map((library) => library.path),
        },
      );

      setScanResult(result);
    } catch (error) {
      setScanResult(null);
      setScanError(String(error));
    } finally {
      setScanning(false);
    }
  }

  return (
    <section className="settings-page">
      <div className="settings-intro">
        <p className="eyebrow">LOCAL GAME DISCOVERY</p>
        <h2>Game Libraries</h2>
        <p>
          Choose the folders PandaVault is allowed to inspect for
          installed games. Add as many drives or game-library locations as you
          need.
        </p>
      </div>

      <div className="privacy-banner">
        <div className="privacy-icon">✓</div>
        <div>
          <strong>You stay in control.</strong>
          <p>
            These locations are stored locally on this computer. PandaVault
            only scans folders you approve.
          </p>
        </div>
      </div>

      <div className="library-toolbar">
        <div>
          <p className="eyebrow">APPROVED LOCATIONS</p>
          <h3>
            {loading
              ? "Loading libraries..."
              : `${libraries.length} ${
                  libraries.length === 1 ? "location" : "locations"
                }`}
          </h3>
        </div>

        <button
          type="button"
          className="add-library-button"
          onClick={addLibraries}
          disabled={adding}
        >
          <span>＋</span>
          {adding ? "Opening picker..." : "Add Game Library"}
        </button>
      </div>

      {storageError && (
        <div className="library-error">
          <strong>Library settings error</strong>
          <span>{storageError}</span>
        </div>
      )}

      {!loading && libraries.length === 0 ? (
        <div className="empty-libraries">
          <div className="empty-library-icon">▦</div>
          <h3>No game libraries added yet</h3>
          <p>
            Add your Steam library, another games folder, or locations from
            additional drives such as D: or E:.
          </p>
          <button
            type="button"
            className="add-library-button"
            onClick={addLibraries}
            disabled={adding}
          >
            <span>＋</span>
            Add your first library
          </button>
        </div>
      ) : (
        <div className="library-list">
          {libraries.map((library) => (
            <article className="library-location-card" key={library.path}>
              <div className="library-location-icon">▰</div>

              <div className="library-location-copy">
                <div className="library-location-heading">
                  <strong>Game Library</strong>
                  <span>LOCAL</span>
                </div>

                <p title={library.path}>{library.path}</p>
              </div>

              <div className="library-location-status">
                <span className="status-dot status-ready" />
                Approved
              </div>

              <button
                type="button"
                className="remove-library-button"
                onClick={() => removeLibrary(library.path)}
                aria-label={`Remove ${library.path}`}
                title="Remove library"
              >
                ×
              </button>
            </article>
          ))}
        </div>
      )}

      <div className="scan-panel">
        <div>
          <p className="eyebrow">GAME DISCOVERY</p>
          <h3>
            {scanResult
              ? `${scanResult.games.length} installed entries found`
              : "Scan approved libraries"}
          </h3>
          <p>
            {scanResult
              ? `${scanResult.steamLibraryPaths.length} Steam ${
                  scanResult.steamLibraryPaths.length === 1
                    ? "library"
                    : "libraries"
                } detected across your approved locations.`
              : "PandaVault will inspect only the locations you approved for supported game libraries and installed titles."}
          </p>
        </div>

        <button
          type="button"
          className="scan-library-button"
          disabled={libraries.length === 0 || scanning}
          onClick={scanLibraries}
        >
          <span>↻</span>
          {scanning ? "Scanning..." : "Scan Libraries"}
        </button>
      </div>

      {scanError && (
        <div className="library-error">
          <strong>Library scan failed</strong>
          <span>{scanError}</span>
        </div>
      )}

      {scanResult && scanResult.games.length > 0 && (
        <div className="scan-results">
          <div className="scan-results-heading">
            <p className="eyebrow">DETECTED STEAM ENTRIES</p>
            <strong>{scanResult.games.length}</strong>
          </div>

          <div className="scan-results-list">
            {scanResult.games.map((game) => (
              <div className="scan-result-game" key={game.appId}>
                <div>
                  <strong>{game.name}</strong>
                  <span>Steam App {game.appId}</span>
                </div>
                <span className="scan-result-path" title={game.installPath}>
                  {game.installPath}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {scanResult && scanResult.warnings.length > 0 && (
        <div className="scan-warnings">
          <strong>Scan warnings</strong>
          {scanResult.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      )}
    </section>
  );
}