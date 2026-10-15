import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Report, SettingGroup, TestCount } from '../types'

const PANE = 'forgecenter'
const report = atom({ plugin: 'forgecenter', key: 'report' } as const, null)
const checking = atom({ plugin: 'forgecenter', key: 'checking' } as const, false)
const lastTests = atom({ plugin: 'forgecenter', key: 'lastTests' } as const, null)

// The .env settings a launch needs, in the order to fix them.
const GROUPS: { label: string; required: boolean; keys: string[] }[] = [
  { label: 'Site address', required: true, keys: ['BASE_URL'] },
  { label: 'Google sign-in', required: true, keys: ['GOOGLE_CLIENT_ID'] },
  { label: 'Owner panel', required: true, keys: ['ADMIN_EMAILS'] },
  { label: 'Payments (Stripe)', required: true, keys: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] },
  { label: 'AI mentor', required: true, keys: ['ANTHROPIC_API_KEY'] },
  { label: 'Bot token encryption', required: true, keys: ['SECRET_KEY'] },
  { label: 'Privacy contact', required: true, keys: ['CONTACT_EMAIL'] },
  { label: 'Minecraft hosting', required: false, keys: ['PTERODACTYL_URL', 'PTERODACTYL_APP_KEY', 'PTERODACTYL_CLIENT_KEY', 'PTERODACTYL_NEST_ID', 'PTERODACTYL_EGG_ID', 'PTERODACTYL_LOCATION_ID'] },
  { label: 'Email', required: false, keys: ['RESEND_API_KEY', 'EMAIL_FROM'] },
  { label: 'GitHub sign-in', required: false, keys: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'] },
  { label: 'Microsoft sign-in', required: false, keys: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'] },
  { label: 'Discord sign-in', required: false, keys: ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'] },
  { label: 'WhatsApp sign-in', required: false, keys: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TEMPLATE'] },
]

// Files that hold secrets or customer data. They must never reach git.
const SECRET_PATH = /(^|\/)\.env$|(^|\/)\.env\.(?!example$)[^/]+$|\.db(-wal|-shm|-journal)?$|(^|\/)data\//

/** KEY=value lines of a .env file; values are only ever checked, never shown. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

/** Whether a setting holds a real value rather than nothing or the example's placeholder. */
export function isFilled(key: string, value: string | undefined): boolean {
  if (!value) return false
  if (/\.\.\.|yourdomain|1234567890-abc|^you@gmail\.com$/i.test(value)) return false
  if (key === 'SECRET_KEY') return value.length >= 32
  if (key === 'ADMIN_EMAILS' || key === 'CONTACT_EMAIL') return value.includes('@')
  return true
}

export function settingGroups(env: Record<string, string>): SettingGroup[] {
  return GROUPS.map(g => ({ label: g.label, required: g.required, missing: g.keys.filter(k => !isFilled(k, env[k])) }))
}

/** Reads node:test's summary lines ("# pass 53", "# fail 0"). */
export function parseTestOutput(text: string): TestCount | null {
  const pass = /^# pass (\d+)/m.exec(text)
  const fail = /^# fail (\d+)/m.exec(text)
  return pass && fail ? { passed: Number(pass[1]), failed: Number(fail[1]) } : null
}

const lines = (text: string) => text.split('\n').map(s => s.trim()).filter(Boolean)

/** The files a git commit or push in `command` would send, or null when it sends none. */
async function filesSentBy($: EngineInterface, command: string): Promise<string[] | null> {
  const git = (...argv: string[]) => $.process.run(['git', ...argv])
  if (/\bgit\b[^;&|]*\bcommit\b/.test(command)) {
    const staged = await git('diff', '--cached', '--name-only')
    const all = /\s-[a-zA-Z]*a|\s--all\b/.test(command) ? await git('diff', '--name-only') : { stdout: '' }
    return [...lines(staged.stdout), ...lines(all.stdout)]
  }
  if (/\bgit\b[^;&|]*\bpush\b/.test(command)) {
    let log = await git('log', '--name-only', '--format=', '@{upstream}..HEAD')
    if (log.exitCode !== 0) log = await git('log', '--name-only', '--format=', 'HEAD', '--not', '--remotes')
    return lines(log.stdout)
  }
  return null
}

async function runChecks($: EngineInterface) {
  if (await read($, checking)) return
  await update($, checking, () => true)
  try {
    const envText: string | null = await $.fs.read('.env').catch(() => null)
    const settings = settingGroups(parseEnv(envText ?? ''))

    const tests = await $.process.run(['npm', 'test'], { timeoutMs: 600_000 })
      .then(r => parseTestOutput(`${r.stdout}\n${r.stderr}`) ?? { error: `npm test stopped with exit code ${r.exitCode}` })
      .catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }))
    if ('passed' in tests) await update($, lastTests, () => tests)

    const status = await $.process.run(['git', 'status', '--porcelain', '--branch']).catch(() => null)
    const git = status && status.exitCode === 0
      ? {
          changed: lines(status.stdout).filter(l => !l.startsWith('##')).length,
          ahead: Number(/\[ahead (\d+)/.exec(status.stdout)?.[1] ?? 0),
        }
      : { error: 'Not a git repository' }

    const result: Report = { checkedAt: await $.clock.now(), hasEnvFile: envText !== null, settings, tests, git }
    await update($, report, () => result)
    const blocking = settings.filter(s => s.required && s.missing.length).length + ('failed' in tests ? tests.failed : 1)
    $.ui.toast(blocking ? 'ForgeCenter isn\'t ready to launch yet. See the ForgeCenter pane.' : 'ForgeCenter is ready to launch.')
  } finally {
    await update($, checking, () => false)
  }
}

const ago = (ms: number) => {
  const minutes = Math.round(ms / 60_000)
  return minutes < 1 ? 'just now' : minutes === 1 ? '1 minute ago' : minutes < 60 ? `${minutes} minutes ago` : `${Math.round(minutes / 60)} hours ago`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'forgecenter', description: 'Check whether ForgeCenter is ready to launch' })
    return next(e)
  })

  on('command.run', { command: 'forgecenter' }, async $ => {
    const isForgeCenter = await $.fs.read('package.json').then(t => /"name":\s*"forgecenter"/.test(t)).catch(() => false)
    if (!isForgeCenter) return { text: 'Open Claude in your ForgeCenter folder to run the launch check.' }
    await $.ui.open({ id: PANE, title: 'ForgeCenter' })
    void runChecks($)
    return { text: 'Running the ForgeCenter launch check. Results appear in the ForgeCenter pane.' }
  })

  // Stops commits and pushes that would put secrets or customer data on GitHub,
  // and shows the latest test result in the status line.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    let sent: string[] | null = null
    try { sent = await filesSentBy($, e.command) } catch { sent = null }
    const leaking = [...new Set((sent ?? []).filter(f => SECRET_PATH.test(f)))]
    if (leaking.length) {
      return {
        deny: `forgecenter: ${leaking.join(', ')} holds secrets or customer data and must never go to git. ` +
          'Unstage it with `git restore --staged <file>` (or drop it from the commit) and make sure .gitignore covers it.',
      }
    }

    const ran = await next(e)
    const counts = /\bnpm (run )?test\b|\bnode\b[^;&|]*--test\b/.test(e.command) && typeof ran.text === 'string'
      ? parseTestOutput(ran.text) : null
    if (counts) {
      await update($, lastTests, () => counts)
      $.ui.status(counts.failed ? `ForgeCenter tests: ${counts.failed} failing` : `ForgeCenter tests: all ${counts.passed} passing`)
    }
    return ran
  }).catch(($, e, next) =>
    // If the guard itself breaks, block only what it guards: commits and pushes.
    next.called || !/\bgit\b[^;&|]*\b(commit|push)\b/.test(e.command)
      ? next(e)
      : { deny: 'forgecenter: the secrets check failed, so this commit or push was stopped. Try again.' },
  )

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const r = await read($, report)
    const busy = await read($, checking)
    const now = await $.clock.now()

    if (!r) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text>{busy ? 'Checking settings, tests and git…' : 'No check yet.'}</Text>
          {!busy && <Button key="run" label="Run the launch check" onPress={() => void runChecks($)} />}
        </Box>
      )
    }

    const requiredMissing = r.settings.filter(s => s.required && s.missing.length)
    const testsOk = 'passed' in r.tests && r.tests.failed === 0
    const ready = requiredMissing.length === 0 && testsOk

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold color={ready ? 'success' : 'warning'}>
          {ready ? 'Ready to launch' : `Not ready yet: ${requiredMissing.length} required setting group${requiredMissing.length === 1 ? '' : 's'} missing${testsOk ? '' : ', tests need attention'}`}
        </Text>

        <Box flexDirection="column">
          <Text bold>{r.hasEnvFile ? 'Settings' : 'Settings (no .env file yet: copy .env.example to .env)'}</Text>
          {r.settings.map(s => (
            <Text key={s.label} color={s.missing.length === 0 ? 'success' : s.required ? 'error' : undefined} dimColor={!s.required && s.missing.length > 0}>
              {`${s.missing.length === 0 ? '✓' : s.required ? '✗' : '○'} ${s.label}${s.missing.length > 0 ? `: ${s.required ? '' : 'optional, '}needs ${s.missing.join(', ')}` : ''}`}
            </Text>
          ))}
        </Box>

        <Text color={testsOk ? 'success' : 'error'}>
          {'passed' in r.tests
            ? (r.tests.failed ? `✗ Tests: ${r.tests.failed} failing, ${r.tests.passed} passing` : `✓ Tests: all ${r.tests.passed} passing`)
            : `✗ Tests didn't run: ${r.tests.error}`}
        </Text>

        <Text dimColor={'error' in r.git || (r.git.changed === 0 && r.git.ahead === 0)}>
          {'error' in r.git
            ? r.git.error
            : r.git.changed === 0 && r.git.ahead === 0
              ? 'Git: everything is committed and pushed'
              : `Git: ${r.git.changed} changed file${r.git.changed === 1 ? '' : 's'}, ${r.git.ahead} commit${r.git.ahead === 1 ? '' : 's'} not pushed`}
        </Text>

        <Box flexDirection="row" gap={1} alignItems="center">
          <Button key="rerun" label={busy ? 'Checking…' : 'Check again'} onPress={() => void runChecks($)} />
          <Text dimColor>{`Checked ${ago(now - r.checkedAt)}`}</Text>
        </Box>
      </Box>
    )
  })
}
