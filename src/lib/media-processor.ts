import {
  buildProvenanceAttemptPlan,
  buildProvenanceMetadataArgs,
  buildVisualMarkerFilter,
  resolveProvenanceConfig,
  type ProvenanceStatus,
} from "./provenance-protection";
import {
  buildVisualProcessingAttemptFilters,
  buildVisualProcessingFallbackFilter,
  buildVisualProcessingFilter,
  buildVisualProcessingWasmSafeFilter,
  composeVideoFilter,
  resolveVisualProcessingConfig,
  type VisualProcessingStatus,
} from "./visual-processing";

export type ProcessingStage =
  | "idle"
  | "preparing"
  | "loading-engine"
  | "writing-files"
  | "encoding"
  | "done"
  | "error";

type FFmpegProgress = { progress?: number };

type FFmpegLike = {
  load: (config: {
    classWorkerURL?: string;
    coreURL?: string;
    wasmURL?: string;
  }) => Promise<unknown>;
  on: (event: "progress", callback: (event: FFmpegProgress) => void) => void;
  writeFile: (path: string, data: Uint8Array) => Promise<unknown>;
  exec: (args: string[]) => Promise<number>;
  readFile: (path: string) => Promise<Uint8Array | string>;
  deleteFile?: (path: string) => Promise<unknown>;
  terminate?: () => void;
};

type FFmpegModule = { FFmpeg: new () => FFmpegLike };

type ProcessMediaOptions = {
  videoFile: File;
  audioFile?: File | null;
  visualLayer: boolean;
  durationSeconds?: number | null;
  onProgress?: (progress: number) => void;
  onStage?: (stage: ProcessingStage) => void;
};

export type ProcessingDiagnostics = {
  processingId: string;
  sha256: string;
  originalAudioIncluded: boolean;
  secondaryAudioIncluded: boolean;
  visualMarkerApplied: boolean;
  provenanceStatus: ProvenanceStatus;
  provenanceStrength: number;
  processingTimeMs: number;
  visualProcessingStatus: VisualProcessingStatus;
  visualProcessingStrength: number;
  visualProcessingOverlay: boolean;
  visualProcessingMaxFrames: number | null;
};

type ProcessMediaResult = {
  blob: Blob;
  fileName: string;
  diagnostics: ProcessingDiagnostics;
};

const FFMPEG_VERSION = "0.12.15";
const CORE_VERSION = "0.12.10";
const CDN = "https://cdn.jsdelivr.net/npm";

function safeExtension(file: File, fallback: string) {
  const match = file.name.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return match?.[1] ?? fallback;
}

function createProcessingId() {
  return crypto.randomUUID();
}

async function sha256Hex(bytes: Uint8Array) {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const buffer = await crypto.subtle.digest("SHA-256", digestInput.buffer);
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function fileToBytes(file: File) {
  return new Uint8Array(await file.arrayBuffer());
}

async function remoteBlobUrl(url: string, mimeType: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("N\u00e3o foi poss\u00edvel carregar o motor de processamento.");
  }
  const buffer = await response.arrayBuffer();
  return URL.createObjectURL(new Blob([buffer], { type: mimeType }));
}

async function createFFmpeg(
  onProgress?: (progress: number) => void,
  onStage?: (stage: ProcessingStage) => void,
) {
  onStage?.("loading-engine");
  const moduleUrl = `${CDN}/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/esm/index.js`;
  const workerModuleUrl = `${CDN}/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/esm/worker.js`;
  const coreBaseUrl = `${CDN}/@ffmpeg/core@${CORE_VERSION}/dist/esm`;
  let ffmpegModule: FFmpegModule;
  try {
    ffmpegModule = (await import(/* @vite-ignore */ moduleUrl)) as FFmpegModule;
  } catch {
    throw new Error(
      "N\u00e3o foi poss\u00edvel iniciar o processador de v\u00eddeo. Verifique sua conex\u00e3o e tente novamente.",
    );
  }
  const ffmpeg = new ffmpegModule.FFmpeg();
  const temporaryUrls: string[] = [];
  ffmpeg.on("progress", ({ progress }) => {
    if (typeof progress !== "number" || !Number.isFinite(progress)) return;
    const normalized = Math.max(0, Math.min(0.98, progress));
    onProgress?.(0.16 + normalized * 0.8);
  });
  try {
    const classWorkerURL = URL.createObjectURL(
      new Blob([`import ${JSON.stringify(workerModuleUrl)};`], {
        type: "text/javascript",
      }),
    );
    temporaryUrls.push(classWorkerURL);
    const coreURL = await remoteBlobUrl(
      `${coreBaseUrl}/ffmpeg-core.js`,
      "text/javascript",
    );
    temporaryUrls.push(coreURL);
    const wasmURL = await remoteBlobUrl(
      `${coreBaseUrl}/ffmpeg-core.wasm`,
      "application/wasm",
    );
    temporaryUrls.push(wasmURL);
    await ffmpeg.load({ classWorkerURL, coreURL, wasmURL });
    return ffmpeg;
  } catch (error) {
    ffmpeg.terminate?.();
    if (error instanceof Error && error.message.includes("motor")) throw error;
    throw new Error(
      "O navegador n\u00e3o conseguiu carregar o processador de v\u00eddeo. Tente novamente em um navegador atualizado.",
    );
  } finally {
    for (const url of temporaryUrls) URL.revokeObjectURL(url);
  }
}

async function hasOriginalAudio(ffmpeg: FFmpegLike, videoName: string) {
  try {
    const exitCode = await ffmpeg.exec([
      "-v", "error", "-i", videoName, "-map", "0:a:0", "-frames:a", "1", "-f", "null", "-",
    ]);
    return exitCode === 0;
  } catch {
    return false;
  }
}

function buildCommand({
  videoName, audioName, outputName, hasOriginalAudioStream, preserveOriginalAudio,
  durationSeconds, visualFilter, metadataArgs, maxFrames,
}: {
  videoName: string; audioName?: string; outputName: string;
  hasOriginalAudioStream: boolean; preserveOriginalAudio: boolean;
  durationSeconds?: number | null; visualFilter: string | null;
  metadataArgs: string[]; maxFrames: number | null;
}) {
  const args: string[] = ["-i", videoName];
  if (audioName) args.push("-i", audioName);
  if (visualFilter) args.push("-vf", visualFilter);
  args.push("-map", "0:v:0");
  if (hasOriginalAudioStream) args.push("-map", "0:a:0");
  if (audioName) args.push("-map", "1:a:0");
  args.push("-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p");
  let outputAudioIndex = 0;
  if (hasOriginalAudioStream) {
    if (preserveOriginalAudio) {
      args.push(`-c:a:${outputAudioIndex}`, "copy");
    } else {
      args.push(`-c:a:${outputAudioIndex}`, "aac", `-b:a:${outputAudioIndex}`, "192k");
    }
    args.push(
      `-disposition:a:${outputAudioIndex}`, "default",
      `-metadata:s:a:${outputAudioIndex}`, "title=Audio original",
      `-metadata:s:a:${outputAudioIndex}`, "handler_name=Audio original",
    );
    outputAudioIndex += 1;
  }
  if (audioName) {
    args.push(
      `-c:a:${outputAudioIndex}`, "aac", `-b:a:${outputAudioIndex}`, "160k",
      `-disposition:a:${outputAudioIndex}`, hasOriginalAudioStream ? "0" : "default",
      `-metadata:s:a:${outputAudioIndex}`, "title=Camada secundaria",
      `-metadata:s:a:${outputAudioIndex}`, "handler_name=Camada secundaria",
    );
  }
  args.push(...metadataArgs, "-movflags", "+faststart");
  if (maxFrames) args.push("-frames:v", String(maxFrames));
  if (durationSeconds && Number.isFinite(durationSeconds) && durationSeconds > 0) {
    args.push("-t", durationSeconds.toFixed(3));
  }
  args.push("-y", outputName);
  return args;
}

export async function processImageMedia(
  imageFile: File,
): Promise<ProcessMediaResult> {
  const startedAt = performance.now();
  const processingId = createProcessingId();
  const runtimeEnv = import.meta.env as unknown as Record<string, unknown>;
  const provenanceConfig = resolveProvenanceConfig(runtimeEnv);
  const visualProcessingConfig = resolveVisualProcessingConfig(runtimeEnv);
  const protectionTiers = buildVisualProcessingAttemptFilters(visualProcessingConfig);
  const provenanceFilter = provenanceConfig.visualMarkerEnabled
    ? buildVisualMarkerFilter(provenanceConfig)
    : null;
  const metadataArgs = buildProvenanceMetadataArgs(processingId, provenanceConfig);
  const ffmpeg = await createFFmpeg();
  const imageName = `input-image.${safeExtension(imageFile, "png")}`;
  const outputName = "media-uniquifier-image.png";
  try {
    await ffmpeg.writeFile(imageName, await fileToBytes(imageFile));
    let exitCode = 1;
    let visualProcessingApplied = false;
    let visualMarkerApplied = false;
    let metadataApplied = false;
    type ImageAttempt = {
      filter: string | null;
      metadata: string[];
      tier: "full" | "wasm-safe" | "fallback" | "none";
      visualApplied: boolean;
    };
    const imageAttempts: ImageAttempt[] = [];
    for (const tier of protectionTiers) {
      imageAttempts.push({
        filter: composeVideoFilter(tier.filter, provenanceFilter),
        metadata: metadataArgs,
        tier: tier.label,
        visualApplied: true,
      });
    }
    if (visualProcessingConfig.fallbackOnError) {
      imageAttempts.push({
        filter: provenanceFilter,
        metadata: metadataArgs,
        tier: "none",
        visualApplied: false,
      });
    }
    imageAttempts.push({ filter: null, metadata: [], tier: "none", visualApplied: false });
    for (let i = 0; i < imageAttempts.length; i += 1) {
      if (i > 0) {
        try { await ffmpeg.deleteFile?.(outputName); } catch { /* ignore */ }
      }
      const attempt = imageAttempts[i];
      const args = ["-i", imageName];
      if (attempt.filter) args.push("-vf", attempt.filter);
      args.push(...attempt.metadata, "-frames:v", "1", "-update", "1", "-y", outputName);
      exitCode = await ffmpeg.exec(args);
      if (exitCode === 0) {
        visualProcessingApplied = attempt.visualApplied;
        visualMarkerApplied = Boolean(provenanceFilter && attempt.filter);
        metadataApplied = attempt.metadata.length > 0;
        if (attempt.tier !== "full") {
          console.warn("[Media Uniquifier] image protection tier", {
            tier: attempt.tier,
            visualApplied: attempt.visualApplied,
          });
        }
        break;
      }
    }
    if (exitCode !== 0) {
      throw new Error("A imagem nao pode ser processada neste formato.");
    }
    const output = await ffmpeg.readFile(outputName);
    if (!(output instanceof Uint8Array)) {
      throw new Error("A imagem final nao pode ser lida.");
    }
    const bytes = Uint8Array.from(output);
    const baseName =
      imageFile.name.replace(/\.[^/.]+$/, "").trim().slice(0, 80) || "imagem";
    const fileName = `${baseName}-processada.png`;
    const sha256 = await sha256Hex(bytes);
    return {
      blob: new Blob([bytes.buffer], { type: "image/png" }),
      fileName,
      diagnostics: {
        processingId,
        sha256,
        originalAudioIncluded: false,
        secondaryAudioIncluded: false,
        visualMarkerApplied,
        provenanceStatus: provenanceConfig.enabled
          ? !metadataApplied
            ? "fallback"
            : visualMarkerApplied
              ? "applied"
              : "metadata-only"
          : "disabled",
        provenanceStrength: provenanceConfig.strength,
        processingTimeMs: Math.round(performance.now() - startedAt),
        visualProcessingStatus: visualProcessingConfig.enabled
          ? visualProcessingApplied
            ? "applied"
            : "fallback"
          : "disabled",
        visualProcessingStrength: visualProcessingConfig.strength,
        visualProcessingOverlay: visualProcessingConfig.overlayEnabled,
        visualProcessingMaxFrames: null,
      },
    };
  } finally {
    try {
      await ffmpeg.deleteFile?.(imageName);
      await ffmpeg.deleteFile?.(outputName);
    } catch {}
    ffmpeg.terminate?.();
  }
}

export async function processMedia({
  videoFile, audioFile, visualLayer, durationSeconds, onProgress, onStage,
}: ProcessMediaOptions): Promise<ProcessMediaResult> {
  const startedAt = performance.now();
  onStage?.("preparing");
  onProgress?.(0.02);
  const processingId = createProcessingId();
  const runtimeEnv = import.meta.env as unknown as Record<string, unknown>;
  const provenanceConfig = resolveProvenanceConfig(runtimeEnv);
  const visualProcessingConfig = resolveVisualProcessingConfig(runtimeEnv);
  const provenanceFilter =
    visualLayer && provenanceConfig.visualMarkerEnabled
      ? buildVisualMarkerFilter(provenanceConfig)
      : null;
  const provenanceOnlyFilter = provenanceFilter;
  const metadataArgs = buildProvenanceMetadataArgs(processingId, provenanceConfig);
  const ffmpeg = await createFFmpeg(onProgress, onStage);
  const videoName = `input-video.${safeExtension(videoFile, "mp4")}`;
  const audioName = audioFile
    ? `input-audio.${safeExtension(audioFile, "mp3")}`
    : undefined;
  const outputName = "media-uniquifier-output.mp4";
  try {
    onStage?.("writing-files");
    onProgress?.(0.1);
    await ffmpeg.writeFile(videoName, await fileToBytes(videoFile));
    if (audioFile && audioName) {
      await ffmpeg.writeFile(audioName, await fileToBytes(audioFile));
    }
    const hasOriginalAudioStream = await hasOriginalAudio(ffmpeg, videoName);
    onStage?.("encoding");
    onProgress?.(0.16);
    const protectionTiers = visualLayer
      ? buildVisualProcessingAttemptFilters(visualProcessingConfig)
      : [];
    type EncodeAttempt = {
      preserveOriginalAudio: boolean;
      visualFilter: string | null;
      metadataArgs: string[];
      visualProcessingApplied: boolean;
      protectionTier: "full" | "wasm-safe" | "fallback" | "none";
    };
    const attempts: EncodeAttempt[] = [];
    const provenancePlans = buildProvenanceAttemptPlan({
      hasOriginalAudio: hasOriginalAudioStream,
      visualMarkerRequested: Boolean(provenanceFilter),
      config: provenanceConfig,
    });
    for (const tier of protectionTiers) {
      for (const plan of provenancePlans) {
        attempts.push({
          preserveOriginalAudio: plan.preserveOriginalAudio,
          visualFilter: plan.useVisualMarker
            ? composeVideoFilter(tier.filter, provenanceFilter)
            : tier.filter,
          metadataArgs: plan.useMetadata ? metadataArgs : [],
          visualProcessingApplied: true,
          protectionTier: tier.label,
        });
      }
    }
    if (visualLayer && visualProcessingConfig.fallbackOnError) {
      for (const plan of provenancePlans) {
        attempts.push({
          preserveOriginalAudio: plan.preserveOriginalAudio,
          visualFilter: plan.useVisualMarker ? provenanceOnlyFilter : null,
          metadataArgs: plan.useMetadata ? metadataArgs : [],
          visualProcessingApplied: false,
          protectionTier: "none",
        });
      }
    }
    if (!visualLayer) {
      for (const plan of provenancePlans) {
        attempts.push({
          preserveOriginalAudio: plan.preserveOriginalAudio,
          visualFilter: plan.useVisualMarker ? provenanceOnlyFilter : null,
          metadataArgs: plan.useMetadata ? metadataArgs : [],
          visualProcessingApplied: false,
          protectionTier: "none",
        });
      }
    }
    const dedupedAttempts = attempts.filter(
      (attempt, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.preserveOriginalAudio === attempt.preserveOriginalAudio &&
            candidate.visualFilter === attempt.visualFilter &&
            candidate.metadataArgs.join("|") === attempt.metadataArgs.join("|") &&
            candidate.visualProcessingApplied === attempt.visualProcessingApplied &&
            candidate.protectionTier === attempt.protectionTier,
        ) === index,
    );
    let successfulAttempt: EncodeAttempt | null = null;
    for (let index = 0; index < dedupedAttempts.length; index += 1) {
      if (index > 0) {
        try { await ffmpeg.deleteFile?.(outputName); } catch { /* ignore */ }
      }
      const attempt = dedupedAttempts[index];
      const exitCode = await ffmpeg.exec(
        buildCommand({
          videoName,
          audioName,
          outputName,
          hasOriginalAudioStream,
          preserveOriginalAudio: attempt.preserveOriginalAudio,
          durationSeconds,
          visualFilter: attempt.visualFilter,
          metadataArgs: attempt.metadataArgs,
          maxFrames: visualProcessingConfig.maxFrames,
        }),
      );
      if (exitCode === 0) {
        successfulAttempt = attempt;
        if (attempt.protectionTier !== "full" && attempt.visualProcessingApplied) {
          console.warn("[Media Uniquifier] video protection tier", {
            tier: attempt.protectionTier,
          });
        }
        break;
      }
      console.warn("[Media Uniquifier] encode attempt failed", {
        attempt: index + 1,
        tier: attempt.protectionTier,
      });
    }
    if (!successfulAttempt) {
      throw new Error("O video nao pode ser processado neste formato.");
    }
    const output = await ffmpeg.readFile(outputName);
    if (!(output instanceof Uint8Array)) {
      throw new Error("O video final nao pode ser lido.");
    }
    const bytes = Uint8Array.from(output);
    const baseName =
      videoFile.name.replace(/\.[^/.]+$/, "").trim().slice(0, 80) || "video";
    const fileName = `${baseName}-processado.mp4`;
    const sha256 = await sha256Hex(bytes);
    return {
      blob: new Blob([bytes.buffer], { type: "video/mp4" }),
      fileName,
      diagnostics: {
        processingId,
        sha256,
        originalAudioIncluded: hasOriginalAudioStream,
        secondaryAudioIncluded: Boolean(audioFile),
        visualMarkerApplied: Boolean(
          successfulAttempt.visualFilter && provenanceFilter,
        ),
        provenanceStatus: provenanceConfig.enabled
          ? successfulAttempt.metadataArgs.length === 0
            ? "fallback"
            : successfulAttempt.visualFilter && provenanceFilter
              ? "applied"
              : "metadata-only"
          : "disabled",
        provenanceStrength: provenanceConfig.strength,
        processingTimeMs: Math.round(performance.now() - startedAt),
        visualProcessingStatus: visualProcessingConfig.enabled
          ? successfulAttempt.visualProcessingApplied
            ? "applied"
            : "fallback"
          : "disabled",
        visualProcessingStrength: visualProcessingConfig.strength,
        visualProcessingOverlay: visualProcessingConfig.overlayEnabled,
        visualProcessingMaxFrames: visualProcessingConfig.maxFrames,
      },
    };
  } finally {
    try {
      await ffmpeg.deleteFile?.(videoName);
      if (audioName) await ffmpeg.deleteFile?.(audioName);
      await ffmpeg.deleteFile?.(outputName);
    } catch {}
    ffmpeg.terminate?.();
  }
}
