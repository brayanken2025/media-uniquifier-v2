# Deploy Media Uniquifier na Vercel

## 1. Importar na Vercel

1. https://vercel.com/new
2. Import Git Repository → `brayanken2025/media-uniquifier-v2`
3. Framework: Vite
4. Build: `npm run build`
5. Output: `dist`
6. Env vars: copiar de `.env.example`
7. Deploy

## 2. Headers COOP/COEP

Já estão em `vercel.json` — necessários para FFmpeg WASM (SharedArrayBuffer).

## 3. Proteção anti-OCR

Arquivos em `src/lib/visual-processing.ts` e `src/lib/media-processor.ts`.
Ajuste `VITE_VISUAL_PROC_STRENGTH` (0.5–1.5).
