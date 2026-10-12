import { useEffect, useRef, useState } from "react";

type IOSVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

function readableTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const fullSeconds = Math.floor(seconds);
  const hours = Math.floor(fullSeconds / 3600);
  const minutes = Math.floor((fullSeconds % 3600) / 60);
  const rest = String(fullSeconds % 60).padStart(2, "0");
  return hours > 0
    ? [hours, String(minutes).padStart(2, "0"), rest].join(":")
    : String(minutes) + ":" + rest;
}

function ControlIcon({ name }: { name: "play" | "pause" | "volume" | "muted" | "fullscreen" | "shrink" }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === "play" && <path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none" />}
      {name === "pause" && <><path d="M8 5v14" strokeWidth="3" /><path d="M16 5v14" strokeWidth="3" /></>}
      {(name === "volume" || name === "muted") && <><path d="M11 5 6.4 9H3v6h3.4l4.6 4V5Z" />{name === "volume" ? <><path d="M15 9a5 5 0 0 1 0 6" /><path d="M18 6a9 9 0 0 1 0 12" /></> : <><path d="m16 9 5 6" /><path d="m21 9-5 6" /></>}</>}
      {name === "fullscreen" && <path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4" />}
      {name === "shrink" && <path d="M4 9h5V4m11 5h-5V4M4 15h5v5m11-5h-5v5" />}
    </svg>
  );
}

/** Presentation-only player. Never transforms or re-encodes the result Blob. */
export default function ResultVideoPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setPlaybackError(false);
  }, [src]);

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  function syncTime() {
    const video = videoRef.current;
    if (!video) return;
    setCurrent(Number.isFinite(video.currentTime) ? video.currentTime : 0);
    setDuration(Number.isFinite(video.duration) ? video.duration : 0);
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => setPlaying(false));
    } else {
      video.pause();
    }
  }

  function seek(value: number) {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(video.duration, value));
    setCurrent(video.currentTime);
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }

  function changeVolume(value: number) {
    const video = videoRef.current;
    if (!video) return;
    video.volume = value;
    video.muted = value === 0;
    setVolume(value);
    setMuted(video.muted);
  }

  async function toggleFullscreen() {
    const frame = frameRef.current;
    if (!frame) return;
    try {
      if (document.fullscreenElement === frame) {
        await document.exitFullscreen();
      } else if (frame.requestFullscreen) {
        await frame.requestFullscreen();
      } else {
        // Safari iPhone has native video fullscreen rather than element fullscreen.
        (videoRef.current as IOSVideo | null)?.webkitEnterFullscreen?.();
      }
    } catch {
      (videoRef.current as IOSVideo | null)?.webkitEnterFullscreen?.();
    }
  }

  const seekPercent = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div ref={frameRef} className="result-video-player" aria-label="Player do vídeo processado">
      <video
        ref={videoRef}
        src={src || undefined}
        playsInline
        preload="metadata"
        onLoadedMetadata={syncTime}
        onDurationChange={syncTime}
        onTimeUpdate={syncTime}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onVolumeChange={(event) => {
          setVolume(event.currentTarget.volume);
          setMuted(event.currentTarget.muted);
        }}
        onError={() => setPlaybackError(true)}
      />
      {playbackError && (
        <p className="player-error" role="alert">
          Não foi possível reproduzir este formato no navegador. Você ainda pode baixar o vídeo.
        </p>
      )}
      <div className="result-player-controls" role="group" aria-label="Controles de reprodução">
        <input
          className="player-seek"
          type="range"
          min={0}
          max={duration || 1}
          step={0.05}
          value={Math.min(current, duration || 1)}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label="Posição do vídeo"
          style={{ background: "linear-gradient(90deg, #349aff " + seekPercent + "%, #344763 " + seekPercent + "%)" }}
        />
        <div className="player-action-row">
          <button type="button" className="player-icon-button" onClick={togglePlayback} aria-label={playing ? "Pausar vídeo" : "Reproduzir vídeo"} title={playing ? "Pausar" : "Reproduzir"}>
            <ControlIcon name={playing ? "pause" : "play"} />
          </button>
          <button type="button" className="player-icon-button" onClick={toggleMute} aria-label={muted || volume === 0 ? "Ativar áudio" : "Silenciar áudio"} title="Áudio">
            <ControlIcon name={muted || volume === 0 ? "muted" : "volume"} />
          </button>
          <input className="player-volume" type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} onChange={(event) => changeVolume(Number(event.target.value))} aria-label="Volume do vídeo" />
          <span className="player-timestamp" aria-label="Tempo reproduzido e duração">
            {readableTime(current)} / {duration > 0 ? readableTime(duration) : "--:--"}
          </span>
          <span className="player-action-spacer" />
          <button type="button" className="player-icon-button" onClick={() => { void toggleFullscreen(); }} aria-label={fullscreen ? "Sair da tela cheia" : "Tela cheia"} title={fullscreen ? "Sair da tela cheia" : "Tela cheia"}>
            <ControlIcon name={fullscreen ? "shrink" : "fullscreen"} />
          </button>
        </div>
      </div>
    </div>
  );
}
