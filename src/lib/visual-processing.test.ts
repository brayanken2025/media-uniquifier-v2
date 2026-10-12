import { describe, expect, it } from "vitest";

import {
  buildVisualProcessingAttemptFilters,
  buildVisualProcessingFallbackFilter,
  buildVisualProcessingFilter,
  buildVisualProcessingWasmSafeFilter,
  composeVideoFilter,
  resolveVisualProcessingConfig,
} from "./visual-processing";

describe("visual processing", () => {
  it("uses hardened production defaults", () => {
    expect(resolveVisualProcessingConfig()).toEqual({
      enabled: true,
      strength: 1.15,
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
    ).toBe(2);

    expect(
      resolveVisualProcessingConfig({ VITE_VISUAL_PROC_MAX_FRAMES: "45" }).maxFrames,
    ).toBe(45);
  });

  it("can be disabled without code changes", () => {
    const config = resolveVisualProcessingConfig({
      VITE_VISUAL_PROC_ENABLED: "false",
    });

    expect(buildVisualProcessingFilter(config)).toBeNull();
    expect(buildVisualProcessingWasmSafeFilter(config)).toBeNull();
    expect(buildVisualProcessingFallbackFilter(config)).toBeNull();
    expect(buildVisualProcessingAttemptFilters(config)).toEqual([]);
  });

  it("builds a full multi-layer anti-OCR chain scaled by strength", () => {
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
    expect((light!.match(/noise=/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(light).not.toBe(strong);
  });

  it("builds a WASM-safe chain without exotic filters", () => {
    const filter = buildVisualProcessingWasmSafeFilter(
      resolveVisualProcessingConfig({ VITE_VISUAL_PROC_STRENGTH: "1.2" }),
    );

    expect(filter).toContain("eq=");
    expect(filter).toContain("hue=");
    expect(filter).toContain("noise=");
    expect(filter).toContain("unsharp=");
    expect(filter).not.toContain("geq=");
    expect(filter).not.toContain("lenscorrection=");
    expect(filter).not.toContain("chromashift=");
  });

  it("orders protection tiers full → wasm-safe → fallback", () => {
    const tiers = buildVisualProcessingAttemptFilters(
      resolveVisualProcessingConfig({ VITE_VISUAL_PROC_STRENGTH: "1.0" }),
    );

    expect(tiers.map((t) => t.label)).toEqual(["full", "wasm-safe", "fallback"]);
    expect(tiers[0].filter).toContain("geq=");
    expect(tiers[1].filter).not.toContain("geq=");
    expect(tiers[2].filter).toContain("noise=");
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
    expect((filter!.match(/drawtext=/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it("provides a minimal fallback filter chain", () => {
    const fallback = buildVisualProcessingFallbackFilter(
      resolveVisualProcessingConfig({ VITE_VISUAL_PROC_STRENGTH: "1.0" }),
    );

    expect(fallback).toContain("eq=");
    expect(fallback).toContain("noise=");
    expect(fallback).toContain("hue=");
    expect(fallback).not.toContain("lenscorrection=");
    expect(fallback).not.toContain("geq=");
  });

  it("composes with the existing provenance filter", () => {
    expect(composeVideoFilter("eq=contrast=1.01", "drawbox=x=0:y=0:w=2:h=2")).toBe(
      "eq=contrast=1.01,drawbox=x=0:y=0:w=2:h=2",
    );
  });
});
