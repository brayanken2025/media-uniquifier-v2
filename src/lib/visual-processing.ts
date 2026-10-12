/**
 * Visual protection layer against automated CV & OCR pipelines.
 *
 * Multi-technique perceptual disruption for the FFmpeg/WASM browser pipeline.
 * Goal: make automated vision/OCR see a *different* signal than a human viewer —
 * degrade text extraction, feature matching, and embedding similarity while
 * keeping the creative legible to people at strength ≈ 1.0–1.2.
 *
 * Design notes (v2 — hardened):
 * - Full chain uses geq + lenscorrection + chromashift when WASM supports them.
 * - WASM-safe chain (noise/eq/hue/unsharp only) is strong enough to still
 *   scramble OCR edges and temporal sampling if exotic filters are missing.
 * - Temporal noise is applied twice so frame-to-frame hash / fingerprint
 *   pipelines see unstable high-frequency energy.
 * - Optional OCR-hostile micro-text floods candidate regions without
 *   dominating human perception at default opacity.
 */

export type VisualProcessingConfig = {
  enabled: boolean;
  strength: number;
  overlayEnabled: boolean;
  overlayText: string;
  maxFrames: number | null;
  fallbackOnError: boolean;
};

export type VisualProcessingStatus = "applied" | "disabled" | "fallback";

const DEFAULT_CONFIG: VisualProcessingConfig = {
  enabled: true,
  strength: 1.15,
  overlayEnabled: false,
  overlayText: "PROTECTED",
  maxFrames: null,
  fallbackOnError: true,
};

function parseBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseStrength(value: unknown) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;

  if (!Number.isFinite(numeric)) return DEFAULT_CONFIG.strength;
  return Math.min(2, Math.max(0.5, numeric));
}

function parseMaxFrames(value: unknown) {
  if (value === null || value === undefined || value === "") return null;

  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.min(1_000_000, Math.floor(numeric));
}

function escapeDrawText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}

export function resolveVisualProcessingConfig(
  env: Record<string, unknown> = {},
): VisualProcessingConfig {
  const rawText = env.VITE_VISUAL_PROC_OVERLAY_TEXT;
  const overlayText =
    typeof rawText === "string" && rawText.trim()
      ? rawText.trim().slice(0, 80)
      : DEFAULT_CONFIG.overlayText;

  return {
    enabled: parseBoolean(
      env.VITE_VISUAL_PROC_ENABLED,
      DEFAULT_CONFIG.enabled,
    ),
    strength: parseStrength(env.VITE_VISUAL_PROC_STRENGTH),
    overlayEnabled: parseBoolean(
      env.VITE_VISUAL_PROC_OVERLAY,
      DEFAULT_CONFIG.overlayEnabled,
    ),
    overlayText,
    maxFrames: parseMaxFrames(env.VITE_VISUAL_PROC_MAX_FRAMES),
    fallbackOnError: parseBoolean(
      env.VITE_VISUAL_PROC_FALLBACK,
      DEFAULT_CONFIG.fallbackOnError,
    ),
  };
}

/**
 * Full anti-OCR / anti-CV filter chain (desktop-class FFmpeg filters).
 *
 * Layer map:
 *  1. Adversarial underpainting     → geq multi-frequency micro-texture
 *  2. Structured + temporal noise   → noise (t+u) primary
 *  3. Micro geometric warp          → lenscorrection barrel
 *  4. Photometric / channel jitter  → eq + hue + chromashift
 *  5. Edge energy for OCR confusion → unsharp residual
 *  6. Secondary temporal grain      → noise temporal only (fingerprint break)
 *  7. Optional OCR-hostile text     → multi-instance drawtext
 *
 * strength 0.5 = mild · 1.0–1.2 = production default · 1.5–2.0 = aggressive
 */
export function buildVisualProcessingFilter(config: VisualProcessingConfig) {
  if (!config.enabled) return null;

  const s = config.strength;

  const geqAmp = (0.028 * s).toFixed(4);
  const geqCb = (0.016 * s).toFixed(4);
  const geqFilter = [
    `geq=`,
    `lum='lum(X,Y)+${geqAmp}*255*(sin(0.22*X*3.14159)+cos(0.17*Y*3.14159)+0.45*sin(0.13*(X+Y))+0.25*sin(0.31*X-0.19*Y))':`,
    `cb='cb(X,Y)+${geqCb}*255*sin(0.11*X+0.07*Y)':`,
    `cr='cr(X,Y)+${geqCb}*255*cos(0.09*Y-0.05*X)'`,
  ].join("");

  const grain = Math.max(4, Math.min(22, Math.round(6 + 10 * s)));
  const noisePrimary = `noise=alls=${grain}:allf=t+u`;

  const k1 = (0.016 * s).toFixed(4);
  const k2 = (0.008 * s).toFixed(4);
  const warpFilter = `lenscorrection=k1=${k1}:k2=${k2}:i=bilinear`;

  const contrast = (1 + 0.055 * s).toFixed(4);
  const saturation = (1 + 0.035 * s).toFixed(4);
  const brightness = (0.008 * s).toFixed(4);
  const gamma = (1 + 0.035 * s).toFixed(4);
  const eqFilter = `eq=contrast=${contrast}:saturation=${saturation}:brightness=${brightness}:gamma=${gamma}`;

  const hueDeg = (3.6 * s).toFixed(2);
  const hueSat = (1 + 0.04 * s).toFixed(3);
  const hueFilter = `hue=h=${hueDeg}:s=${hueSat}`;

  const chromaH = Math.max(1, Math.round(1.8 * s));
  const chromaV = Math.max(0, Math.round(1.1 * s));
  const chromaFilter = `chromashift=cbh=${chromaH}:crh=-${chromaH}:cbv=${chromaV}:crv=-${chromaV}`;

  const sharpen = Math.min(0.35, 0.14 * s).toFixed(3);
  const unsharpFilter = `unsharp=5:5:${sharpen}:5:5:0.0`;

  const grain2 = Math.max(2, Math.min(12, Math.round(3 + 5 * s)));
  const noiseSecondary = `noise=alls=${grain2}:allf=t`;

  const filters: string[] = [
    geqFilter,
    noisePrimary,
    warpFilter,
    eqFilter,
    hueFilter,
    chromaFilter,
    unsharpFilter,
    noiseSecondary,
  ];

  if (config.overlayEnabled) {
    const text = escapeDrawText(config.overlayText);
    const opacity = Math.min(0.28, 0.14 + 0.06 * s).toFixed(3);
    const opacity2 = (Number(opacity) * 0.75).toFixed(3);
    const fontSize = "h/32";
    filters.push(
      `drawtext=text='${text}':fontcolor=white@${opacity}:fontsize=${fontSize}:x=(w-text_w)/2:y=h*0.12`,
      `drawtext=text='${text}':fontcolor=white@${opacity}:fontsize=${fontSize}:x=w*0.08:y=h*0.48`,
      `drawtext=text='${text}':fontcolor=white@${opacity2}:fontsize=${fontSize}:x=w*0.52:y=h*0.72`,
      `drawtext=text='${text}':fontcolor=black@${opacity2}:fontsize=${fontSize}:x=w*0.28:y=h*0.88`,
    );
  }

  return filters.join(",");
}

/**
 * WASM-safe aggressive chain — only filters widely present in @ffmpeg/core.
 * Used as intermediate tier when full chain fails (missing geq/lenscorrection).
 */
export function buildVisualProcessingWasmSafeFilter(
  config: VisualProcessingConfig,
) {
  if (!config.enabled) return null;

  const s = config.strength;

  const grain = Math.max(5, Math.min(20, Math.round(7 + 9 * s)));
  const grain2 = Math.max(3, Math.min(12, Math.round(4 + 5 * s)));
  const contrast = (1 + 0.06 * s).toFixed(4);
  const saturation = (1 + 0.04 * s).toFixed(4);
  const brightness = (0.01 * s).toFixed(4);
  const gamma = (1 + 0.04 * s).toFixed(4);
  const hueDeg = (4.2 * s).toFixed(2);
  const hueSat = (1 + 0.05 * s).toFixed(3);
  const sharpen = Math.min(0.32, 0.16 * s).toFixed(3);

  const filters: string[] = [
    `eq=contrast=${contrast}:saturation=${saturation}:brightness=${brightness}:gamma=${gamma}`,
    `hue=h=${hueDeg}:s=${hueSat}`,
    `noise=alls=${grain}:allf=t+u`,
    `unsharp=5:5:${sharpen}:5:5:0.0`,
    `noise=alls=${grain2}:allf=t`,
  ];

  if (config.overlayEnabled) {
    const text = escapeDrawText(config.overlayText);
    const opacity = Math.min(0.24, 0.12 + 0.05 * s).toFixed(3);
    filters.push(
      `drawtext=text='${text}':fontcolor=white@${opacity}:fontsize=h/30:x=(w-text_w)/2:y=h*0.2`,
      `drawtext=text='${text}':fontcolor=white@${opacity}:fontsize=h/30:x=w*0.1:y=h*0.65`,
    );
  }

  return filters.join(",");
}

/**
 * Minimal fallback when even WASM-safe chain fails.
 */
export function buildVisualProcessingFallbackFilter(
  config: VisualProcessingConfig,
) {
  if (!config.enabled) return null;

  const s = config.strength;
  const grain = Math.max(4, Math.min(16, Math.round(5 + 7 * s)));
  const contrast = (1 + 0.04 * s).toFixed(4);
  const saturation = (1 + 0.025 * s).toFixed(4);
  const hueDeg = (2.5 * s).toFixed(2);

  const filters = [
    `eq=contrast=${contrast}:saturation=${saturation}:brightness=0.006`,
    `hue=h=${hueDeg}`,
    `noise=alls=${grain}:allf=t+u`,
  ];

  if (config.overlayEnabled) {
    const text = escapeDrawText(config.overlayText);
    const opacity = Math.min(0.2, 0.1 + 0.04 * s).toFixed(3);
    filters.push(
      `drawtext=text='${text}':fontcolor=white@${opacity}:fontsize=h/26:x=(w-text_w)/2:y=h-text_h-28`,
    );
  }

  return filters.join(",");
}

export function composeVideoFilter(
  visualProcessingFilter: string | null,
  provenanceFilter: string | null,
) {
  const filters = [visualProcessingFilter, provenanceFilter].filter(
    (value): value is string => Boolean(value),
  );

  return filters.length ? filters.join(",") : null;
}

/**
 * Ordered protection tiers for the media pipeline.
 * Caller should try each filter string until FFmpeg exec returns 0.
 */
export function buildVisualProcessingAttemptFilters(
  config: VisualProcessingConfig,
): Array<{ label: "full" | "wasm-safe" | "fallback"; filter: string }> {
  if (!config.enabled) return [];

  const tiers: Array<{ label: "full" | "wasm-safe" | "fallback"; filter: string }> =
    [];

  const full = buildVisualProcessingFilter(config);
  if (full) tiers.push({ label: "full", filter: full });

  const wasmSafe = buildVisualProcessingWasmSafeFilter(config);
  if (wasmSafe) tiers.push({ label: "wasm-safe", filter: wasmSafe });

  const fallback = buildVisualProcessingFallbackFilter(config);
  if (fallback) tiers.push({ label: "fallback", filter: fallback });

  return tiers;
}
