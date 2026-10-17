import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Report, SettingGroup, TestCount } from '../types'

const PANE = 'forgecenter'
const report = atom({ plugin: 'forgecenter', key: 'report' } as const, null)
const checking = atom({ plugin: 'forgecenter', key: 'checking' } as const, false)
const lastTests = atom({ plugin: 'forgecenter', key: 'lastTests' } as const, null)
const lastPassAt = atom({ plugin: 'forgecenter', key: 'lastPassAt' } as const, null)

// The .env settings a launch needs, in the order to fix them.
const GROUPS: { label: string; required: boolean; keys: string[] }[] = [
  { label: 'Site address', required: true, keys: ['BASE_URL'] },
  { label: 'Google sign-in', required: true, keys: ['GOOGLE_CLIENT_ID'] },
  { label: 'Owner panel', required: true, keys: ['ADMIN_EMAILS'] },
  { label: 'Payments (Stripe)', required: true, keys: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] },
  { label: 'AI mentor and help desk', required: true, keys: ['ANTHROPIC_API_KEY'] },
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
    if (m?.[1]) out[m[1]] = (m[2] ?? '').replace(/^(['"])(.*)\1$/, '$2')
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

// Rules from CLAUDE.md that an edit to the site's server code must never break.
const CODE_RULES: { pattern: RegExp; why: string }[] = [
  {
    pattern: /\bpayment_method_types\b/g,
    why: 'passes payment_method_types to Stripe. ForgeCenter uses dynamic payment methods, so leave it out and choose payment methods in the Stripe Dashboard instead.',
  },
  {
    pattern: /\b(?:ALTER\s+TABLE|CREATE\s+TABLE|INSERT\s+INTO|UPDATE)\b[^;`]*\b(?:dob|date_of_birth|birth_?date|birthday)\b/gi,
    why: 'stores a date of birth. Age checks keep only the outcome (the age group, the method and when it was confirmed).',
  },
]
const SERVER_CODE = /(^|\/)src\/[^/]+\.(m?js|ts)$/

/** Why replacing `before` with `after` in `path` breaks a project rule, or null when it doesn't. */
export function brokenRule(path: string, before: string, after: string): string | null {
  if (!SERVER_CODE.test(path)) return null
  const count = (re: RegExp, text: string) => text.match(re)?.length ?? 0
  return CODE_RULES.find(r => count(r.pattern, after) > count(r.pattern, before))?.why ?? null
}

// Things that look like real secrets. Example values in the repo (".env.example", tests
// that build fakes from parts) are too short or broken up to match.
const SECRET_PATTERNS: { kind: string; pattern: RegExp }[] = [
  { kind: 'Stripe secret or restricted key', pattern: /\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}/ },
  { kind: 'Stripe webhook signing secret', pattern: /\bwhsec_[0-9A-Za-z]{24,}/ },
  { kind: 'Anthropic API key', pattern: /\bsk-ant-[0-9A-Za-z_-]{20,}/ },
  { kind: 'Pterodactyl API key', pattern: /\bptl[ac]_[0-9A-Za-z]{20,}/ },
  { kind: 'Discord bot token', pattern: /\b[MNO][0-9A-Za-z_-]{23,25}\.[0-9A-Za-z_-]{6}\.[0-9A-Za-z_-]{27,38}\b/ },
  { kind: 'Resend API key', pattern: /\bre_[0-9A-Za-z]{8,}_[0-9A-Za-z]{12,}/ },
  { kind: 'GitHub token', pattern: /\b(?:gh[pousr]_[0-9A-Za-z]{36,}|github_pat_[0-9A-Za-z_]{60,})/ },
  { kind: 'Google OAuth client secret', pattern: /\bGOCSPX-[0-9A-Za-z_-]{20,}/ },
  { kind: 'Meta (WhatsApp) access token', pattern: /\bEAA[0-9A-Za-z]{60,}/ },
  { kind: 'private key', pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
]

/** The lines a unified diff adds, with their file and new line number. */
export function addedLines(diff: string): { file: string; line: number; text: string }[] {
  const out: { file: string; line: number; text: string }[] = []
  let file = ''
  let line = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) { file = raw.slice(4).replace(/^b\//, ''); continue }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw)
    if (hunk) { line = Number(hunk[1]); continue }
    if (raw.startsWith('+')) { out.push({ file, line, text: raw.slice(1) }); line += 1 }
    else if (raw.startsWith(' ')) line += 1
  }
  return out
}

/** Where an added line looks like a secret, never the secret itself. */
export function findSecrets(diff: string): { file: string; line: number; kind: string }[] {
  const found: { file: string; line: number; kind: string }[] = []
  for (const l of addedLines(diff)) {
    const hit = SECRET_PATTERNS.find(p => p.pattern.test(l.text))
    if (hit) found.push({ file: l.file, line: l.line, kind: hit.kind })
  }
  return found
}

// Code the tests cover: a commit touching it needs a passing run from after the change.
export const TESTED_CODE = /^(src|public\/js|test|templates\/discord-bot\/src)\//

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

const isCommit = (command: string) => /\bgit\b[^;&|]*\bcommit\b/.test(command)
const isPush = (command: string) => /\bgit\b[^;&|]*\bpush\b/.test(command)
const commitsAll = (command: string) => /\s-[a-zA-Z]*a|\s--all\b/.test(command)

/** The added content a commit or push in `command` would send, as a zero-context diff. */
async function diffSentBy($: EngineInterface, command: string): Promise<string> {
  const git = (...argv: string[]) => $.process.run(['git', ...argv])
  if (isCommit(command)) {
    const staged = await git('diff', '--cached', '-U0', '--no-color', '--no-ext-diff')
    const all = commitsAll(command) ? await git('diff', '-U0', '--no-color', '--no-ext-diff') : { stdout: '' }
    return `${staged.stdout}\n${all.stdout}`
  }
  if (isPush(command)) {
    let log = await git('log', '-p', '-U0', '--no-color', '--format=', '@{upstream}..HEAD')
    if (log.exitCode !== 0) log = await git('log', '-p', '-U0', '--no-color', '--format=', 'HEAD', '--not', '--remotes')
    return log.stdout
  }
  return ''
}

/** Tested code a commit in `command` would include (added, copied, modified or renamed). */
async function codeCommittedBy($: EngineInterface, command: string): Promise<string[]> {
  const git = (...argv: string[]) => $.process.run(['git', ...argv])
  const staged = await git('diff', '--cached', '--name-only', '--diff-filter=ACMR')
  const all = commitsAll(command) ? await git('diff', '--name-only', '--diff-filter=ACMR') : { stdout: '' }
  return [...new Set([...lines(staged.stdout), ...lines(all.stdout)])].filter(f => TESTED_CODE.test(f))
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

    if (isCommit(e.command) || isPush(e.command)) {
      const secrets = findSecrets(await diffSentBy($, e.command))
      if (secrets.length) {
        const where = secrets.slice(0, 5).map(s => `${s.file}:${s.line} (${s.kind})`).join(', ')
        return {
          deny: `forgecenter: this ${isPush(e.command) ? 'push' : 'commit'} adds what looks like a real secret at ${where}. ` +
            'Move it to .env or the host\'s secret settings and read it from process.env. If it was ever pushed, rotate it with the provider.',
        }
      }
    }

    if (isCommit(e.command)) {
      const code = await codeCommittedBy($, e.command)
      if (code.length) {
        const passedAt = await read($, lastPassAt)
        const root = (await $.process.run(['git', 'rev-parse', '--show-toplevel'])).stdout.trim()
        const changedAfter: string[] = []
        for (const f of code) {
          const stat = await $.fs.stat(`${root}/${f}`).catch(() => undefined)
          if (stat && (passedAt === null || stat.mtimeMs > passedAt)) changedAfter.push(f)
        }
        if (changedAfter.length) {
          return {
            deny: `forgecenter: ${changedAfter.slice(0, 5).join(', ')}${changedAfter.length > 5 ? ` and ${changedAfter.length - 5} more` : ''} ` +
              `changed ${passedAt === null ? 'and the tests haven\'t passed in this session yet' : 'since the tests last passed'}. ` +
              'Run npm test, fix anything failing, then commit again (CLAUDE.md: run tests before every commit).',
          }
        }
      }
    }

    const startedAt = await $.clock.now()
    const ran = await next(e)
    const counts = /\bnpm (run )?test\b|\bnode\b[^;&|]*--test\b/.test(e.command) && typeof ran.text === 'string'
      ? parseTestOutput(ran.text) : null
    if (counts) {
      await update($, lastTests, () => counts)
      // Only a full run counts (not one test file), and only when nothing failed.
      const fullRun = /\bnpm (run )?test\b/.test(e.command) && !/\bnpm (run )?test\b\S*\s+--?\s*\S/.test(e.command)
      if (fullRun && counts.failed === 0 && counts.passed > 0) await update($, lastPassAt, () => startedAt)
      $.ui.status(counts.failed ? `ForgeCenter tests: ${counts.failed} failing` : `ForgeCenter tests: all ${counts.passed} passing`)
    }
    return ran
  }).catch(($, e, next) =>
    // If a guard itself breaks, block only what it guards: commits and pushes.
    next.called || !/\bgit\b[^;&|]*\b(commit|push)\b/.test(e.command)
      ? next(e)
      : { deny: 'forgecenter: the secrets check failed, so this commit or push was stopped. Try again.' },
  )

  // Keeps edits to the site's server code inside the project's payment and privacy rules.
  // A broken guard lets the edit through: it catches mistakes, it isn't a security boundary.
  on('tool.call', { tool: 'Edit' }, ($, e, next) => {
    const why = brokenRule(e.file_path, e.old_string, e.new_string)
    return why ? { deny: `forgecenter: this edit to ${e.file_path} ${why}` } : next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const before: string = await $.fs.read(e.file_path).catch(() => '')
    const why = brokenRule(e.file_path, before, e.content)
    return why ? { deny: `forgecenter: writing ${e.file_path} ${why}` } : next(e)
  }).catch(($, e, next) => next(e))

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
