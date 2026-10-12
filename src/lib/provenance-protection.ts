/** Proveniência de autoria: marcadores e metadados verificáveis com fallback seguro. */
export type ProvenanceStatus = "applied" | "metadata-only" | "fallback" | "disabled";
export type ProvenanceConfig = {
  enabled: boolean;
  visualMarkerEnabled: boolean;
  strength: number;
  label: string;
  fallbackOnError: boolean;
};
export type ProvenanceAttempt = {
  preserveOriginalAudio: boolean;
  useVisualMarker: boolean;
  useMetadata: boolean;
};

const bool = (v: unknown, fallback: boolean) =>
  v === true || v === "true" || v === "1" || v === "yes"
    ? true
    : v === false || v === "false" || v === "0" || v === "no"
      ? false
      : fallback;

export function resolveProvenanceConfig(env: Record<string, unknown> = {}): ProvenanceConfig {
  const input = Number(env.VITE_PROVENANCE_STRENGTH);
  return {
    enabled: bool(env.VITE_PROVENANCE_ENABLED, true),
    visualMarkerEnabled: bool(env.VITE_PROVENANCE_VISUAL_MARKER, true),
    strength: Number.isFinite(input) && input > 0 ? Math.min(1.5, Math.max(0.5, input)) : 1,
    label: String(env.VITE_PROVENANCE_LABEL ?? "Media Uniquifier").slice(0, 96),
    fallbackOnError: bool(env.VITE_PROVENANCE_FALLBACK, true),
  };
}

export function buildProvenanceMetadataArgs(processingId: string, config: ProvenanceConfig): string[] {
  if (!config.enabled) return [];
  const label = config.label.replace(/[\r\n\x00]/g, " ");
  const id = processingId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
  return ["-metadata", `comment=${label} | ID: ${id}`, "-metadata", `creation_tool=${label}`];
}

export function buildVisualMarkerFilter(config: ProvenanceConfig): string | null {
  if (!config.enabled || !config.visualMarkerEnabled) return null;
  const opacity = (0.14 * config.strength).toFixed(3);
  return `drawbox=x=iw-16:y=ih-16:w=7:h=7:color=white@${opacity}:t=fill`;
}

export function buildProvenanceAttemptPlan({
  hasOriginalAudio,
  visualMarkerRequested,
  config,
}: {
  hasOriginalAudio: boolean;
  visualMarkerRequested: boolean;
  config: ProvenanceConfig;
}): ProvenanceAttempt[] {
  const marker = config.enabled && config.visualMarkerEnabled && visualMarkerRequested;
  const initial: ProvenanceAttempt[] = [
    { preserveOriginalAudio: true, useVisualMarker: marker, useMetadata: config.enabled },
  ];
  if (hasOriginalAudio) initial.push({ preserveOriginalAudio: false, useVisualMarker: marker, useMetadata: config.enabled });
  if (marker && config.fallbackOnError) {
    initial.push({ preserveOriginalAudio: !hasOriginalAudio, useVisualMarker: false, useMetadata: config.enabled });
  }
  if (config.fallbackOnError && config.enabled) {
    initial.push({ preserveOriginalAudio: !hasOriginalAudio, useVisualMarker: false, useMetadata: false });
  }
  return initial;
}
