import { describe, expect, it } from "vitest";

import {
  buildVisualProcessingFallbackFilter,
  buildVisualProcessingFilter,
  composeVideoFilter,
  resolveVisualProcessingConfig,
} from "./visual-processing";

describe("visual processing", () => {
  it("uses production-safe defaults", () => {
    expect(resolveVisualProcessingConfig()).toEqual({
      enabled: true,
      strength: 1,
      overlayEnabled: false,
      overlayText: "PROTECTED",
      maxFrames: null,
      fallbackOnError: true,
    });
  });

  it("clamps strength and max frames", () => {
    expect(
      resolveVisualProcessingConfig({ VITE_VISUAL_PROC_STRENGTH: "0.1" }).strength,
    ).toBe(0.5);

    expect(
      resolveVisualProcessingConfig({ VITE_VISUAL_PROC_STRENGTH: "9" }).strength,
    ).toBe(1.5);

    expect(
      resolveVisualProcessingConfig({ VITE_VISUAL_PROC_MAX_FRAMES: "45" }).maxFrames,
    ).toBe(45);
  });

  it("can be disabled without code changes", () => {
    const config = resolveVisualProcessingConfig({
      VITE_VISUAL_PROC_ENABLED: "false",
    });

    expect(buildVisualProcessingFilter(config)).toBeNull();
    expect(buildVisualProcessingFallbackFilter(config)).toBeNull();
  });

  it("applies multi-layer anti-OCR / anti-CV filters scaled by strength", () => {
    const light = buildVisualProcessingFilter(
      resolveVisualProcessingConfig({ VITE_VISUAL_PROC_STRENGTH: "0.5" }),
    );
    const strong = buildVisualProcessingFilter(
      resolveVisualProcessingConfig({ VITE_VISUAL_PROC_STRENGTH: "1.5" }),
    );

    expect(light).toContain("noise=");
    expect(light).toContain("geq=");
    expect(light).toContain("lenscorrection=");
    expect(light).toContain("eq=");
    expect(light).toContain("hue=");
    expect(light).toContain("chromashift=");
    expect(light).toContain("unsharp=");
    expect(light).not.toBe(strong);
  });

  it("adds optional OCR-hostile overlay instances", () => {
    const filter = buildVisualProcessingFilter(
      resolveVisualProcessingConfig({
        VITE_VISUAL_PROC_OVERLAY: "true",
        VITE_VISUAL_PROC_OVERLAY_TEXT: "MY ASSET",
      }),
    );

    expect(filter).toContain("drawtext=");
    expect(filter).toContain("MY ASSET");
    expect((filter!.match(/drawtext=/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("provides a lighter fallback filter chain", () => {
    const fallback = buildVisualProcessingFallbackFilter(
      resolveVisualProcessingConfig({ VITE_VISUAL_PROC_STRENGTH: "1.0" }),
    );

    expect(fallback).toContain("eq=");
    expect(fallback).toContain("noise=");
    expect(fallback).not.toContain("lenscorrection=");
    expect(fallback).not.toContain("geq=");
  });

  it("composes with the existing provenance filter", () => {
    expect(composeVideoFilter("eq=contrast=1.01", "drawbox=x=0:y=0:w=2:h=2")).toBe(
      "eq=contrast=1.01,drawbox=x=0:y=0:w=2:h=2",
    );
  });
});
