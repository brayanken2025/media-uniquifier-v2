import { useEffect, useState } from "react";
import ResultVideoPlayer from "./components/ResultVideoPlayer";
import {
  processImageMedia,
  processMedia,
  type ProcessingDiagnostics,
  type ProcessingStage,
} from "./lib/media-processor";

type Output = { blob: Blob; fileName: string; diagnostics: ProcessingDiagnostics };
function readableSize(n: number) {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Read the source duration locally so a longer secondary audio track
// cannot extend the exported MP4 beyond the original video.
async function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const preview = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    let finished = false;
    let timer = 0;

    const complete = (value: number | null) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      preview.removeAttribute("src");
      preview.load();
      URL.revokeObjectURL(objectUrl);
      resolve(value);
    };

    preview.preload = "metadata";
    preview.onloadedmetadata = () => {
      const duration = preview.duration;
      complete(Number.isFinite(duration) && duration > 0 ? duration : null);
    };
    preview.onerror = () => complete(null);
    timer = window.setTimeout(() => complete(null), 8000);
    preview.src = objectUrl;
    preview.load();
  });
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export default function App() {
  const [media, setMedia] = useState<File | null>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [visualLayer, setVisualLayer] = useState(true);
  const [sourceDuration, setSourceDuration] = useState<number | null>(null);
  const [, setStage] = useState<ProcessingStage>("idle");
  const [, setProgress] = useState(0);
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const [outputUrl, setOutputUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const isImage = Boolean(media?.type.startsWith("image/"));
  const outputIsImage = Boolean(output?.blob.type.startsWith("image/"));
  const showProgressPanel = working || Boolean(error) || Boolean(output);
  // Only the setup experience is visible before a task starts, or after an error.
  // While processing and after success, render one focused card at a time.
  const showSetup = !working && !output;

  useEffect(() => {
    if (!media) { setMediaUrl(""); return; }
    const url = URL.createObjectURL(media);
    setMediaUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [media]);

  useEffect(() => {
    if (!output) { setOutputUrl(""); return; }
    const url = URL.createObjectURL(output.blob);
    setOutputUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [output]);

  function chooseFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("video/") && !file.type.startsWith("image/")) {
      setError("Escolha um vídeo ou uma imagem válida.");
      return;
    }
    setMedia(file);
    setSourceDuration(null);
    setAudio(null);
    setOutput(null);
    setProgress(0);
    setError("");
    setStage("idle");
  }

  async function process() {
    if (!media || working) return;
    setWorking(true);
    setOutput(null);
    setError("");
    setProgress(0);
    setStage("preparing");
    try {
      // An external audio track may be longer than the source video.
      // media-processor.ts already supports durationSeconds (-t);
      // supply the actual duration instead of letting audio extend the output.
      const durationSeconds = !media.type.startsWith("image/") && audio
        ? sourceDuration ?? await readVideoDuration(media)
        : null;
      const result = media.type.startsWith("image/")
        ? await processImageMedia(media)
        : await processMedia({
            videoFile: media,
            audioFile: audio,
            visualLayer,
            durationSeconds,
            onProgress: setProgress,
            onStage: setStage,
          });
      setOutput(result);
      setProgress(1);
      setStage("done");
    } catch (e) {
      setStage("error");
      setError(e instanceof Error ? e.message : "Não foi possível processar este arquivo.");
    } finally {
      setWorking(false);
    }
  }

  function reset() {
    if (working) return;
    setMedia(null);
    setSourceDuration(null);
    setAudio(null);
    setOutput(null);
    setStage("idle");
    setProgress(0);
    setError("");
  }

  return (
    <div className="site">
      <main className={`container main ${showSetup ? "" : "main-focused"}`}>
        {showSetup && <div className="intro">
          <h1>Seu conteúdo, <span>seu controle.</span></h1>
          <p>Envie a mídia, configure o processamento e acompanhe cada etapa. Uma experiência profissional, diretamente no seu navegador.</p>
        </div>}
        <div className={`workspace ${showSetup ? (showProgressPanel ? "workspace-active" : "workspace-initial") : "workspace-focused"}`}>
          {showSetup && <div className="home-zuck-decor" aria-hidden="true">
            <img src="/assets/mark-head.webp" className="home-zuck-head" alt="" draggable={false} />
            <img src="/assets/mark-shoulders.webp" className="home-zuck-shoulders" alt="" draggable={false} />
          </div>}
          {showSetup && <section className="card left" aria-label="Configuração do processamento">
            <div className="section-head"><div><h2>Arquivo original</h2></div>{media && !working && <button className="text-button" onClick={reset}>Trocar arquivo</button>}</div>
            {!media ? (
              <label className={`drop ${dragging ? "dragging" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
                onDrop={(e) => { e.preventDefault(); setDragging(false); chooseFile(e.dataTransfer.files?.[0]); }}>
                <span className="upload-icon">↑</span>
                <strong>Envie seu vídeo ou imagem</strong>
                <span>Arraste o arquivo para cá ou clique para selecioná-lo.</span>
                <small>Compatível com MP4, MOV, WebM, PNG, JPG e formatos aceitos pelo navegador.</small>
                <input type="file" accept="video/*,image/*" onChange={(e) => { chooseFile(e.target.files?.[0]); e.currentTarget.value = ""; }} />
              </label>
            ) : (
              <div className="uploaded">
                <div className="media-preview">
                  {mediaUrl && (isImage ? <img src={mediaUrl} alt="Prévia da imagem selecionada" /> : <video src={mediaUrl} controls playsInline preload="metadata" onLoadedMetadata={e => {
                    const duration = e.currentTarget.duration;
                    setSourceDuration(Number.isFinite(duration) && duration > 0 ? duration : null);
                  }} />)}
                </div>
                <div className="file-details"><span className="file-icon">{isImage ? "▧" : "▷"}</span><div><strong title={media.name}>{media.name}</strong><span>{readableSize(media.size)} · {isImage ? "Imagem" : "Vídeo"}</span></div><span className="selected">Pronto</span></div>
              </div>
            )}
            <div className="separator"/>
            <div className="section-head"><div><h2>Configure o processamento</h2></div></div>
            <label className={`option ${isImage ? "muted" : ""}`}>
              <span className="option-text"><strong>Camada visual</strong><small>Aplica ajustes visuais configurados durante a renderização.</small></span>
              <input type="checkbox" checked={visualLayer} disabled={working || isImage} onChange={e => setVisualLayer(e.target.checked)} />
            </label>
            <label className={`option audio-option ${!media || isImage || working ? "muted" : ""}`}>
              <span className="option-text"><strong>Áudio secundário <em>Opcional</em></strong><small>Mantém o áudio original e adiciona uma faixa separada ao vídeo.</small></span>
              <span className="file-select">{audio ? "Alterar" : "Adicionar"}</span>
              <input type="file" accept="audio/*" disabled={!media || isImage || working} onChange={e => setAudio(e.target.files?.[0] ?? null)} />
            </label>
            {audio && !isImage && <div className="audio-added"><span>♫</span><span title={audio.name}>{audio.name} · {readableSize(audio.size)}</span><button disabled={working} onClick={() => setAudio(null)} aria-label="Remover áudio">×</button></div>}
            <button className="primary" type="button" disabled={!media || working} onClick={process}>{working ? "Processando mídia…" : "Gerar nova mídia"} <span>{working ? "◌" : "→"}</span></button>
            <p className="support-text">Arquivos grandes podem demorar e exigem memória disponível no dispositivo. Não feche esta aba durante o processamento.</p>
          </section>}
          {showProgressPanel && <section className={working ? "processing-only" : "card right"} aria-live="polite" aria-label={working ? "Processamento em andamento" : "Resultado do processamento"}>
            {!working && <div className="section-head"><div><h2>{error ? "Status do processamento" : "Seu vídeo ficou pronto"}</h2></div>{output && <span className="done-tag">✓ Concluído</span>}</div>}
            {working ? (
              <div className="processing">
                <div className="loader" aria-hidden="true"/>
                <h3>Processando o vídeo.</h3>
                <p>Estamos preparando seu arquivo no navegador. Não feche esta página até o processamento terminar.</p>
              </div>
            ) : error ? (
              <div className="empty"><span className="large-icon danger">!</span><h3>Não foi possível concluir</h3><p>{error}</p><button className="secondary" onClick={process} disabled={!media}>Tentar novamente</button></div>
            ) : output ? (
              <div className="result">
                <div className="result-preview">{outputIsImage ? <img src={outputUrl} alt="Imagem processada" /> : <ResultVideoPlayer src={outputUrl} />}</div>
                <div className="result-info"><strong>{output.fileName}</strong><small>{readableSize(output.blob.size)} · Gerado com sucesso</small></div>
                <button className="primary" onClick={() => downloadBlob(output.blob, output.fileName)}>↓ Baixar arquivo</button>
                <button className="secondary" type="button" onClick={reset}>Criar novo vídeo</button>
                <div className="diagnostics"><span>ID de processamento</span><code>{output.diagnostics.processingId}</code><span>SHA-256</span><code>{output.diagnostics.sha256}</code><span>Áudio original</span><strong>{output.diagnostics.originalAudioIncluded ? "Preservado" : "Não detectado"}</strong><span>Áudio adicional</span><strong>{output.diagnostics.secondaryAudioIncluded ? "Incluído" : "Não incluído"}</strong><span>Proveniência</span><strong>{output.diagnostics.provenanceStatus}</strong><span>Processamento visual</span><strong>{output.diagnostics.visualProcessingStatus}</strong></div>
              </div>
            ) : (
              <div className="empty"><span className="large-icon">▷</span><h3>Seu resultado aparecerá aqui</h3><p>Selecione um arquivo, configure as opções e comece o processamento.</p><div className="empty-lines"><span/><span/><span/></div></div>
            )}
          </section>}
        </div>
        {showSetup && <footer className="footer">MEDIA UNIQUIFIER · Processamento de mídia no dispositivo · Nenhum arquivo enviado ao servidor</footer>}
      </main>
    </div>
  );
}
