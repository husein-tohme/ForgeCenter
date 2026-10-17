export type TestCount = { passed: number; failed: number }

/** One group of .env settings and the keys in it that aren't filled in yet. */
export type SettingGroup = { label: string; required: boolean; missing: string[] }

export type Report = {
  checkedAt: number
  hasEnvFile: boolean
  settings: SettingGroup[]
  tests: TestCount | { error: string }
  git: { changed: number; ahead: number } | { error: string }
}

declare module 'claude-code' {
  interface PluginState {
    forgecenter: {
      report: Report | null
      checking: boolean
      lastTests: TestCount | null
      /** When the latest fully passing test run started ($.clock.now() milliseconds). */
      lastPassAt: number | null
    }
  }
}
