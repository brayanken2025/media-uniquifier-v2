/**
 * Visual protection layer against automated CV & OCR pipelines.
 *
 * Multi-technique perceptual disruption compatible with the FFmpeg/WASM
 * browser pipeline. Mirrors the reference Python stack
 * (structured noise, adversarial texture, micro geometric distortion,
 * contrast/channel jitter, temporal perturbation, optional OCR-hostile overlay)
 * using filters available in @ffmpeg/core.
 *
 * Goal: degrade OCR / vision model success rate while keeping content
 * legible to humans at strength ≈ 1.0.
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
  strength: 1,
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
  return Math.min(1.5, Math.max(0.5, numeric));
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
 * Full anti-OCR / anti-CV filter chain.
 *
 * Layer mapping (Python reference → FFmpeg):
 *  1. Structured high-frequency noise  → noise + mild unsharp
 *  2. Adversarial underpainting        → geq sinusoidal micro-texture
 *  3. Micro geometric warp             → lenscorrection mild barrel
 *  4. Contrast + channel jitter        → eq + hue + chromashift
 *  5. Temporal flicker                 → noise with temporal component
 *  6. OCR-hostile overlay (optional)   → multiple drawtext instances
 *
 * strength 0.5 = mild, 1.0 = default, 1.3–1.5 = aggressive.
 */
export function buildVisualProcessingFilter(config: VisualProcessingConfig) {
  if (!config.enabled) return null;

  const s = config.strength;

  // 1 + 5. High-frequency + temporal noise
  const grain = Math.max(2, Math.min(18, Math.round(4 + 8 * s)));
  const noiseFilter = `noise=alls=${grain}:allf=t+u`;

  // 2. Soft adversarial underpainting via geq
  const geqAmp = (0.012 * s).toFixed(4);
  const geqFilter = [
    `geq=`,
    `lum='lum(X,Y)+${geqAmp}*255*(sin(0.18*X*3.14159)+cos(0.14*Y*3.14159)+0.5*sin(0.11*(X+Y)))':`,
    `cb='cb(X,Y)+${(0.008 * s).toFixed(4)}*255*sin(0.09*X)':`,
    `cr='cr(X,Y)+${(0.008 * s).toFixed(4)}*255*cos(0.07*Y)'`,
  ].join("");

  // 3. Micro geometric warp
  const k1 = (0.008 * s).toFixed(4);
  const k2 = (0.004 * s).toFixed(4);
  const warpFilter = `lenscorrection=k1=${k1}:k2=${k2}:i=bilinear`;

  // 4. Contrast + channel / hue jitter
  const contrast = (1 + 0.028 * s).toFixed(4);
  const saturation = (1 + 0.018 * s).toFixed(4);
  const brightness = (0.004 * s).toFixed(4);
  const eqFilter = `eq=contrast=${contrast}:saturation=${saturation}:brightness=${brightness}`;

  const hueDeg = (1.8 * s).toFixed(2);
  const hueFilter = `hue=h=${hueDeg}`;
  const chromaH = Math.max(1, Math.round(1.2 * s));
  const chromaV = Math.max(0, Math.round(0.8 * s));
  const chromaFilter = `chromashift=cbh=${chromaH}:crh=-${chromaH}:cbv=${chromaV}:crv=-${chromaV}`;

  // Mild unsharp — residual high-frequency energy after warp
  const sharpen = Math.min(0.22, 0.09 * s).toFixed(3);
  const unsharpFilter = `unsharp=5:5:${sharpen}:5:5:0.0`;

  const filters: string[] = [
    geqFilter,
    noiseFilter,
    warpFilter,
    eqFilter,
    hueFilter,
    chromaFilter,
    unsharpFilter,
  ];

  // 6. Optional OCR-hostile overlay — multiple semi-transparent instances
  if (config.overlayEnabled) {
    const text = escapeDrawText(config.overlayText);
    const opacity = Math.min(0.22, 0.12 + 0.05 * s).toFixed(3);
    const fontSize = "h/28";
    filters.push(
      `drawtext=text='${text}':fontcolor=white@${opacity}:fontsize=${fontSize}:x=(w-text_w)/2:y=h*0.18`,
      `drawtext=text='${text}':fontcolor=white@${opacity}:fontsize=${fontSize}:x=w*0.12:y=h*0.55`,
      `drawtext=text='${text}':fontcolor=white@${(Number(opacity) * 0.85).toFixed(3)}:fontsize=${fontSize}:x=w*0.55:y=h*0.78`,
    );
  }

  return filters.join(",");
}

/**
 * Lighter fallback when the full chain fails (codec / filter support).
 * Still applies noise + mild eq so protection is not zero.
 */
export function buildVisualProcessingFallbackFilter(
  config: VisualProcessingConfig,
) {
  if (!config.enabled) return null;

  const s = config.strength;
  const grain = Math.max(2, Math.min(12, Math.round(3 + 5 * s)));
  const contrast = (1 + 0.02 * s).toFixed(4);
  const saturation = (1 + 0.012 * s).toFixed(4);

  const filters = [
    `eq=contrast=${contrast}:saturation=${saturation}:brightness=0`,
    `noise=alls=${grain}:allf=t+u`,
  ];

  if (config.overlayEnabled) {
    const text = escapeDrawText(config.overlayText);
    const opacity = Math.min(0.18, 0.1 + 0.04 * s).toFixed(3);
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
