# Media Uniquifier v2

Processamento local de vídeo/imagem com:
- **Proteção anti-OCR / anti-CV** multi-camada (FFmpeg filters)
- Proveniência e metadados
- Deploy pronto para **Vercel**

## Repositório

https://github.com/brayanken2025/media-uniquifier-v2

## Arquivos de proteção

Estrutura:

```
src/lib/visual-processing.ts
src/lib/visual-processing.test.ts
src/lib/media-processor.ts
scripts/video_content_protection.py
vercel.json
.env.example
```

Pack completo (artefato): `media-uniquifier-vercel-pack.zip`

## Deploy Vercel

1. https://vercel.com/new → import `brayanken2025/media-uniquifier-v2`
2. Framework: **Vite** · Build: `npm run build` · Output: `dist`
3. Env vars: ver `.env.example`
4. Deploy

Headers COOP/COEP já estão em `vercel.json` (necessários para FFmpeg WASM).

## Variáveis

| Variável | Default |
|----------|---------|
| VITE_VISUAL_PROC_ENABLED | true |
| VITE_VISUAL_PROC_STRENGTH | 1.0 |
| VITE_VISUAL_PROC_OVERLAY | false |
| VITE_PROVENANCE_ENABLED | true |
