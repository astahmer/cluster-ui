import { defineConfig } from "@playwright/test"
import { defineBddConfig } from "playwright-bdd"

const testDir = defineBddConfig({
  features: "tests/bdd/features/**/*.feature",
  steps: "tests/bdd/steps/**/*.ts",
  outputDir: "tests/bdd/.features-gen",
  missingSteps: "fail-on-gen"
})

export default defineConfig({
  testDir,
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:8797",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: {
    command: "pnpm build && node scripts/pw-bdd-server.mjs",
    url: "http://127.0.0.1:8797/healthz",
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe"
  }
})
