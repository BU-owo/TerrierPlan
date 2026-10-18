import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import process from 'node:process'

// One id per build, baked into the bundle (import.meta.env.VITE_BUILD_ID)
// and written to dist/version.json, so an open tab can tell a newer deploy
// is live (see UpdateBanner.jsx). The commit hash when git is available,
// else a timestamp. BUILD_ID in the environment overrides both (local
// testing: two builds of the same commit).
function resolveBuildId() {
  if (process.env.BUILD_ID) return process.env.BUILD_ID
  try {
    const hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    if (hash) return hash
  } catch {
    // no git: fall through to a timestamp
  }
  return String(Date.now())
}

const buildId = resolveBuildId()

function versionFile() {
  return {
    name: 'terrierplan-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId }) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionFile()],
  define: {
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId),
  },
})
