import {
  buildProvenanceAttemptPlan,
  buildProvenanceMetadataArgs,
  buildVisualMarkerFilter,
  resolveProvenanceConfig,
  type ProvenanceStatus,
} from "./provenance-protection";
import {
  buildVisualProcessingFallbackFilter,
  buildVisualProcessingFilter,
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

type FFmpegProgress = {
  progress?: number;
};

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

type FFmpegModule = {
  FFmpeg: new () => FFmpegLike;
};

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
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(bytes: Uint8Array) {
  const buffer = await crypto.subtle.digest("SHA-256", bytes);
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
    throw new Error("Não foi possível carregar o motor de processamento.");
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
      "Não foi possível iniciar o processador de vídeo. Verifique sua conexão e tente novamente.",
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
      "O navegador não conseguiu carregar o processador de vídeo. Tente novamente em um navegador atualizado.",
    );
  } finally {
    for (const url of temporaryUrls) URL.revokeObjectURL(url);
  }
}

async function hasOriginalAudio(ffmpeg: FFmpegLike, videoName: string) {
  try {
    const exitCode = await ffmpeg.exec([
      "-v",
      "error",
      "-i",
      videoName,
      "-map",
      "0:a:0",
      "-frames:a",
      "1",
      "-f",
      "null",
      "-",
    ]);
    return exitCode === 0;
  } catch {
    return false;
  }
}

function buildCommand({
  videoName,
  audioName,
  outputName,
  hasOriginalAudioStream,
  preserveOriginalAudio,
  durationSeconds,
  visualFilter,
  metadataArgs,
  maxFrames,
}: {
  videoName: string;
  audioName?: string;
  outputName: string;
  hasOriginalAudioStream: boolean;
  preserveOriginalAudio: boolean;
  durationSeconds?: number | null;
  visualFilter: string | null;
  metadataArgs: string[];
  maxFrames: number | null;
}) {
  const args: string[] = ["-i", videoName];

  if (audioName) {
    args.push("-i", audioName);
  }

  if (visualFilter) {
    args.push("-vf", visualFilter);
  }

  args.push("-map", "0:v:0");

  if (hasOriginalAudioStream) {
    args.push("-map", "0:a:0");
  }

  if (audioName) {
    args.push("-map", "1:a:0");
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
  );

  let outputAudioIndex = 0;

  if (hasOriginalAudioStream) {
    if (preserveOriginalAudio) {
      args.push(`-c:a:${outputAudioIndex}`, "copy");
    } else {
      args.push(
        `-c:a:${outputAudioIndex}`,
        "aac",
        `-b:a:${outputAudioIndex}`,
        "192k",
      );
    }

    args.push(
      `-disposition:a:${outputAudioIndex}`,
      "default",
      `-metadata:s:a:${outputAudioIndex}`,
      "title=Áudio original",
      `-metadata:s:a:${outputAudioIndex}`,
      "handler_name=Áudio original",
    );
    outputAudioIndex += 1;
  }

  if (audioName) {
    args.push(
      `-c:a:${outputAudioIndex}`,
      "aac",
      `-b:a:${outputAudioIndex}`,
      "160k",
      `-disposition:a:${outputAudioIndex}`,
      hasOriginalAudioStream ? "0" : "default",
      `-metadata:s:a:${outputAudioIndex}`,
      "title=Camada secundária",
      `-metadata:s:a:${outputAudioIndex}`,
      "handler_name=Camada secundária",
    );
  }

  args.push(...metadataArgs, "-movflags", "+faststart");

  if (maxFrames) {
    args.push("-frames:v", String(maxFrames));
  }

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

  const visualFilter = buildVisualProcessingFilter(visualProcessingConfig);
  const visualFallbackFilter = buildVisualProcessingFallbackFilter(
    visualProcessingConfig,
  );
  const provenanceFilter = provenanceConfig.visualMarkerEnabled
    ? buildVisualMarkerFilter(provenanceConfig)
    : null;
  const combinedFilter = composeVideoFilter(visualFilter, provenanceFilter);
  const lightCombinedFilter = composeVideoFilter(
    visualFallbackFilter,
    provenanceFilter,
  );
  const metadataArgs = buildProvenanceMetadataArgs(processingId, provenanceConfig);

  const ffmpeg = await createFFmpeg();
  const imageName = `input-image.${safeExtension(imageFile, "png")}`;
  const outputName = "media-uniquifier-image.png";

  try {
    await ffmpeg.writeFile(imageName, await fileToBytes(imageFile));

    const fullArgs = ["-i", imageName];
    if (combinedFilter) fullArgs.push("-vf", combinedFilter);
    fullArgs.push(...metadataArgs, "-frames:v", "1", "-update", "1", "-y", outputName);

    let exitCode = await ffmpeg.exec(fullArgs);
    let visualProcessingApplied = Boolean(visualFilter);
    let visualMarkerApplied = Boolean(provenanceFilter);
    let metadataApplied = metadataArgs.length > 0;

    // Intermediate: lighter anti-OCR filter if full chain fails
    if (
      exitCode !== 0 &&
      visualFilter &&
      visualFallbackFilter &&
      visualProcessingConfig.fallbackOnError
    ) {
      try {
        await ffmpeg.deleteFile?.(outputName);
      } catch {}

      const lightArgs = ["-i", imageName];
      if (lightCombinedFilter) lightArgs.push("-vf", lightCombinedFilter);
      lightArgs.push(...metadataArgs, "-frames:v", "1", "-update", "1", "-y", outputName);
      exitCode = await ffmpeg.exec(lightArgs);
      visualProcessingApplied = exitCode === 0;
      visualMarkerApplied = Boolean(provenanceFilter) && exitCode === 0;
      metadataApplied = metadataArgs.length > 0 && exitCode === 0;

      console.warn("[Media Uniquifier] image visual processing light fallback", {
        visualMarker: visualMarkerApplied,
        provenanceMetadata: metadataApplied,
      });
    }

    // Last visual fallback: provenance only
    if (
      exitCode !== 0 &&
      visualFilter &&
      visualProcessingConfig.fallbackOnError
    ) {
      try {
        await ffmpeg.deleteFile?.(outputName);
      } catch {}

      const fallbackArgs = ["-i", imageName];
      if (provenanceFilter) fallbackArgs.push("-vf", provenanceFilter);
      fallbackArgs.push(...metadataArgs, "-frames:v", "1", "-update", "1", "-y", outputName);
      exitCode = await ffmpeg.exec(fallbackArgs);
      visualProcessingApplied = false;
      visualMarkerApplied = Boolean(provenanceFilter) && exitCode === 0;
      metadataApplied = metadataArgs.length > 0 && exitCode === 0;

      console.warn("[Media Uniquifier] image visual processing fallback", {
        visualMarker: visualMarkerApplied,
        provenanceMetadata: metadataApplied,
      });
    }

    if (exitCode !== 0) {
      try {
        await ffmpeg.deleteFile?.(outputName);
      } catch {}

      exitCode = await ffmpeg.exec([
        "-i",
        imageName,
        "-frames:v",
        "1",
        "-update",
        "1",
        "-y",
        outputName,
      ]);
      visualProcessingApplied = false;
      visualMarkerApplied = false;
      metadataApplied = false;

      console.warn("[Media Uniquifier] image protection fallback", {
        protectionRemoved: true,
      });
    }

    if (exitCode !== 0) {
      throw new Error("A imagem não pôde ser processada neste formato.");
    }

    const output = await ffmpeg.readFile(outputName);
    if (!(output instanceof Uint8Array)) {
      throw new Error("A imagem final não pôde ser lida.");
    }

    const bytes = Uint8Array.from(output);
    const baseName =
      imageFile.name.replace(/\.[^/.]+$/, "").trim().slice(0, 80) || "imagem";
    const fileName = `${baseName}-processada.png`;
    const sha256 = await sha256Hex(bytes);

    const result: ProcessMediaResult = {
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

    console.info("[Media Uniquifier] image processing complete", {
      fileName,
      processingId,
      visualProcessingApplied,
      visualMarkerApplied,
      metadataApplied,
      processingTimeMs: Math.round(performance.now() - startedAt),
    });

    return result;
  } finally {
    try {
      await ffmpeg.deleteFile?.(imageName);
      await ffmpeg.deleteFile?.(outputName);
    } catch {}
    ffmpeg.terminate?.();
  }
}

export async function processMedia({
  videoFile,
  audioFile,
  visualLayer,
  durationSeconds,
  onProgress,
  onStage,
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
  const visualProcessingFilter =
    visualLayer && visualProcessingConfig.enabled
      ? buildVisualProcessingFilter(visualProcessingConfig)
      : null;
  const visualProcessingFallbackFilter =
    visualLayer && visualProcessingConfig.enabled
      ? buildVisualProcessingFallbackFilter(visualProcessingConfig)
      : null;
  const provenanceOnlyFilter = provenanceFilter;
  const metadataArgs = buildProvenanceMetadataArgs(
    processingId,
    provenanceConfig,
  );

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

    // Attempt order:
    // 1. Full multi-layer anti-OCR filter + provenance
    // 2. Lighter fallback visual filter + provenance (if full chain fails)
    // 3. Provenance only / no visual protection (last resort)
    const baseAttempts = buildProvenanceAttemptPlan({
      hasOriginalAudio: hasOriginalAudioStream,
      visualMarkerRequested: Boolean(provenanceFilter),
      config: provenanceConfig,
    }).map((plan) => ({
      preserveOriginalAudio: plan.preserveOriginalAudio,
      visualFilter: plan.useVisualMarker
        ? composeVideoFilter(visualProcessingFilter, provenanceFilter)
        : visualProcessingFilter,
      metadataArgs: plan.useMetadata ? metadataArgs : [],
      visualProcessingApplied: Boolean(visualProcessingFilter),
    }));

    const attempts = [...baseAttempts];

    if (
      visualProcessingFilter &&
      visualProcessingFallbackFilter &&
      visualProcessingConfig.fallbackOnError
    ) {
      for (const plan of buildProvenanceAttemptPlan({
        hasOriginalAudio: hasOriginalAudioStream,
        visualMarkerRequested: Boolean(provenanceOnlyFilter),
        config: provenanceConfig,
      })) {
        attempts.push({
          preserveOriginalAudio: plan.preserveOriginalAudio,
          visualFilter: plan.useVisualMarker
            ? composeVideoFilter(
                visualProcessingFallbackFilter,
                provenanceOnlyFilter,
              )
            : visualProcessingFallbackFilter,
          metadataArgs: plan.useMetadata ? metadataArgs : [],
          visualProcessingApplied: true,
        });
      }
    }

    if (visualProcessingFilter && visualProcessingConfig.fallbackOnError) {
      for (const plan of buildProvenanceAttemptPlan({
        hasOriginalAudio: hasOriginalAudioStream,
        visualMarkerRequested: Boolean(provenanceOnlyFilter),
        config: provenanceConfig,
      })) {
        attempts.push({
          preserveOriginalAudio: plan.preserveOriginalAudio,
          visualFilter: plan.useVisualMarker ? provenanceOnlyFilter : null,
          metadataArgs: plan.useMetadata ? metadataArgs : [],
          visualProcessingApplied: false,
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
            candidate.visualProcessingApplied === attempt.visualProcessingApplied,
        ) === index,
    );

    let successfulAttempt:
      | (typeof dedupedAttempts)[number]
      | null = null;

    for (let index = 0; index < dedupedAttempts.length; index += 1) {
      if (index > 0) {
        try {
          await ffmpeg.deleteFile?.(outputName);
        } catch {
          // The previous attempt may have failed before writing an output file.
        }
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
        break;
      }

      console.warn("[Media Uniquifier] encode attempt failed", {
        attempt: index + 1,
        visualMarker: Boolean(attempt.visualFilter),
        provenanceMetadata: attempt.metadataArgs.length > 0,
        preserveOriginalAudio: attempt.preserveOriginalAudio,
        visualProcessing: attempt.visualProcessingApplied,
      });
    }

    if (!successfulAttempt) {
      throw new Error(
        "O vídeo não pôde ser processado neste formato. Tente usar um arquivo MP4, MOV ou WebM.",
      );
    }

    const output = await ffmpeg.readFile(outputName);
    if (!(output instanceof Uint8Array)) {
      throw new Error("O arquivo final não pôde ser lido.");
    }

    const bytes = Uint8Array.from(output);
    const baseName =
      videoFile.name.replace(/\.[^/.]+$/, "").trim().slice(0, 80) || "video";
    const fileName = `${baseName}-processado.mp4`;
    const sha256 = await sha256Hex(bytes);
    const visualMarkerApplied = Boolean(
      provenanceFilter &&
        successfulAttempt.visualFilter?.includes(provenanceFilter),
    );
    const metadataApplied = successfulAttempt.metadataArgs.length > 0;
    const visualProcessingApplied = successfulAttempt.visualProcessingApplied;

    let visualProcessingStatus: VisualProcessingStatus = "disabled";
    if (visualLayer && visualProcessingConfig.enabled) {
      visualProcessingStatus = visualProcessingApplied ? "applied" : "fallback";
    }

    let provenanceStatus: ProvenanceStatus = "disabled";
    if (provenanceConfig.enabled) {
      if (!metadataApplied || (provenanceFilter && !visualMarkerApplied)) {
        provenanceStatus = "fallback";
      } else if (visualMarkerApplied) {
        provenanceStatus = "applied";
      } else {
        provenanceStatus = "metadata-only";
      }
    }

    const processingTimeMs = Math.round(performance.now() - startedAt);

    const diagnostics: ProcessingDiagnostics = {
      processingId,
      sha256,
      originalAudioIncluded: hasOriginalAudioStream,
      secondaryAudioIncluded: Boolean(audioName),
      visualMarkerApplied,
      provenanceStatus,
      provenanceStrength: provenanceConfig.strength,
      processingTimeMs,
      visualProcessingStatus,
      visualProcessingStrength: visualProcessingConfig.strength,
      visualProcessingOverlay: visualProcessingConfig.overlayEnabled,
      visualProcessingMaxFrames: visualProcessingConfig.maxFrames,
    };

    console.info("[Media Uniquifier] processing complete", diagnostics);

    onProgress?.(1);
    onStage?.("done");

    return {
      blob: new Blob([bytes.buffer], { type: "video/mp4" }),
      fileName,
      diagnostics,
    };
  } finally {
    try {
      await ffmpeg.deleteFile?.(videoName);
      if (audioName) await ffmpeg.deleteFile?.(audioName);
      await ffmpeg.deleteFile?.(outputName);
    } catch {
      // Cleanup is best-effort; terminating the worker releases the in-memory FS.
    }
    ffmpeg.terminate?.();
  }
}
