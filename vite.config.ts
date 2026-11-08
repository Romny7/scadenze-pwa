import { defineConfig } from 'vite';
// base './' => funziona sia in locale sia su GitHub Pages (sotto-percorso /nome-repo/)
export default defineConfig({ base: './', worker: { format: 'es' }, build: { target: 'es2022' } });
