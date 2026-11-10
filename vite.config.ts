import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the build works at a GitHub Pages project path
  // (e.g. /2octaver/), at a custom domain, or from any subdirectory.
  base: './',
});
