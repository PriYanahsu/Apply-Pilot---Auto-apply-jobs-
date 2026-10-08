/**
 * FILE: wxt.config.ts
 * WHAT: Build config + Chrome manifest (permissions, side panel, host access).
 * CALLED BY: WXT when you run `npm run dev` / `npm run build`.
 * IF IT BREAKS: compare permissions with BUILD_PROMPT.md section 10 (keep them minimal).
 */
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'ApplyPilot - Auto Apply for Naukri & LinkedIn',
    short_name: 'ApplyPilot',
    description: 'Finds fresh Naukri and LinkedIn jobs that match your resume and applies to them, inside your own Chrome.',
    permissions: ['storage', 'sidePanel', 'tabs', 'scripting', 'alarms', 'notifications', 'unlimitedStorage'],
    host_permissions: ['https://*.naukri.com/*', 'https://www.linkedin.com/*', 'https://generativelanguage.googleapis.com/*'],
    action: { default_title: 'Open ApplyPilot' },
  },
});
