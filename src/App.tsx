import { useEffect, useState } from "react";
import {
  processImageMedia,
  processMedia,
  type ProcessingDiagnostics,
  type ProcessingStage,
} from "./lib/media-processor";

type Output = { blob: Blob; fileName: string; diagnostics: ProcessingDiagnostics };
const labels: Record<ProcessingStage, string> = {
  idle: "Pronto para começar",
  preparing: "Preparando o arquivo",
  "loading-engine": "Carregando motor de vídeo",
  "writing-files": "Preparando as mídias",
  encoding: "Processando o vídeo",
  done: "Processamento concluído",
  error: "Ocorreu um erro",
};

function readableSize(n: number) {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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
  const [stage, setStage] = useState<ProcessingStage>("idle");
  const [progress, setProgress] = useState(0);
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const [outputUrl, setOutputUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const isImage = Boolean(media?.type.startsWith("image/"));
  const outputIsImage = Boolean(output?.blob.type.startsWith("image/"));

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
      const result = media.type.startsWith("image/")
        ? await processImageMedia(media)
        : await processMedia({
            videoFile: media,
            audioFile: audio,
            visualLayer,
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
    setAudio(null);
    setOutput(null);
    setStage("idle");
    setProgress(0);
    setError("");
  }

  return (
    <div className="site">
      <header className="header">
        <div className="container header-inner">
          <div className="brand"><span className="brand-mark">M</span><span>MEDIA <b>UNIQUIFIER</b></span></div>
          <span className="status"><span className="status-dot"/> Processamento local no navegador</span>
        </div>
      </header>
      <main className="container main">
        <div className="intro">
          <span className="eyebrow">ESTÚDIO DE MÍDIA</span>
          <h1>Transforme sua mídia <span>com controle e qualidade.</span></h1>
          <p>Envie um vídeo ou imagem, escolha as opções e gere uma nova versão. Seus arquivos são processados no navegador, sem envio a um servidor.</p>
        </div>
        <div className="workspace">
          <section className="card left" aria-label="Configuração do processamento">
            <div className="section-head"><div><span className="step">01</span><h2>Arquivo original</h2></div>{media && !working && <button className="text-button" onClick={reset}>Trocar arquivo</button>}</div>
            {!media ? (
              <label className={`drop ${dragging ? "dragging" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
                onDrop={(e) => { e.preventDefault(); setDragging(false); chooseFile(e.dataTransfer.files?.[0]); }}>
                <span className="upload-icon">↑</span>
                <strong>Arraste sua mídia até aqui</strong>
                <span>ou clique para selecionar um arquivo</span>
                <small>MP4, MOV, WebM, PNG, JPG e outros formatos compatíveis</small>
                <input type="file" accept="video/*,image/*" onChange={(e) => { chooseFile(e.target.files?.[0]); e.currentTarget.value = ""; }} />
              </label>
            ) : (
              <div className="uploaded">
                <div className="media-preview">
                  {mediaUrl && (isImage ? <img src={mediaUrl} alt="Prévia da imagem selecionada" /> : <video src={mediaUrl} controls playsInline preload="metadata" />)}
                </div>
                <div className="file-details"><span className="file-icon">{isImage ? "▧" : "▷"}</span><div><strong title={media.name}>{media.name}</strong><span>{readableSize(media.size)} · {isImage ? "Imagem" : "Vídeo"}</span></div><span className="selected">Pronto</span></div>
              </div>
            )}
            <div className="separator"/>
            <div className="section-head"><div><span className="step">02</span><h2>Personalize o processamento</h2></div></div>
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
          </section>
          <section className="card right" aria-live="polite" aria-label="Resultado">
            <div className="section-head"><div><span className="step">03</span><h2>Resultado</h2></div>{output && <span className="done-tag">✓ Concluído</span>}</div>
            {working ? (
              <div className="processing"><div className="loader"/><h3>{labels[stage]}</h3><p>Aguarde enquanto a mídia é preparada.</p><div className="meter"><div style={{width: `${Math.round(progress * 100)}%`}}/></div><strong>{Math.round(progress * 100)}%</strong></div>
            ) : error ? (
              <div className="empty"><span className="large-icon danger">!</span><h3>Não foi possível concluir</h3><p>{error}</p><button className="secondary" onClick={process} disabled={!media}>Tentar novamente</button></div>
            ) : output ? (
              <div className="result">
                <div className="result-preview">{outputIsImage ? <img src={outputUrl} alt="Imagem processada" /> : <video src={outputUrl} controls playsInline preload="metadata" />}</div>
                <div className="result-info"><strong>{output.fileName}</strong><small>{readableSize(output.blob.size)} · Gerado com sucesso</small></div>
                <button className="primary" onClick={() => downloadBlob(output.blob, output.fileName)}>↓ Baixar arquivo</button>
                <button className="secondary" onClick={() => downloadBlob(new Blob([JSON.stringify(output.diagnostics, null, 2)], {type:"application/json"}), `${output.fileName}.report.json`)}>↓ Baixar relatório de processamento (JSON)</button>
                <div className="diagnostics"><span>ID de processamento</span><code>{output.diagnostics.processingId}</code><span>SHA-256</span><code>{output.diagnostics.sha256}</code><span>Áudio original</span><strong>{output.diagnostics.originalAudioIncluded ? "Preservado" : "Não detectado"}</strong><span>Áudio adicional</span><strong>{output.diagnostics.secondaryAudioIncluded ? "Incluído" : "Não incluído"}</strong><span>Proveniência</span><strong>{output.diagnostics.provenanceStatus}</strong><span>Processamento visual</span><strong>{output.diagnostics.visualProcessingStatus}</strong></div>
              </div>
            ) : (
              <div className="empty"><span className="large-icon">▷</span><h3>Seu resultado aparecerá aqui</h3><p>Selecione um arquivo, configure as opções e comece o processamento.</p><div className="empty-lines"><span/><span/><span/></div></div>
            )}
          </section>
        </div>
        <footer className="footer">MEDIA UNIQUIFIER · Processamento de mídia no dispositivo · Nenhum arquivo enviado ao servidor</footer>
      </main>
    </div>
  );
}
