import { BundleSource, GameplayBundle } from "./GameplayBundle";

/**
 * Writes what is actually running into the page's `#status` element: which
 * engine, which bundle, and where it came from. Without this, a `?bundle=`
 * URL that silently fell back to the static content looks like a success.
 */
export function showStatus(
  engine: string,
  bundle: GameplayBundle,
  result: { source: BundleSource; error?: string }
): void {
  const el = document.getElementById("status");
  if (!el) return;
  const origin =
    result.source.kind === "remote"
      ? `compiled bundle · ${result.source.url}`
      : "static /game content";
  const counts = `${bundle.scenes.length} scene(s) · ${bundle.entities.length} entities · ${bundle.triggers.length} triggers`;
  el.textContent = `${engine} · ${bundle.game.title} · ${origin} · ${counts}`;
  if (result.error) {
    el.textContent += ` · bundle fetch failed (${result.error}), fell back`;
    el.classList.add("error");
  }
}
