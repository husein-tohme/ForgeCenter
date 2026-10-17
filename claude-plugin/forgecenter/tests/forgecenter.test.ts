import { describe, expect, test } from 'claude-code/testing'

// Made-up secret values, built from parts so secret scanners never mistake them for real keys.
const FAKE_STRIPE = ['rk', 'test', 'not', 'real', 'stripe'].join('_')
const FAKE_RESEND = ['re', 'not', 'real', 'resend'].join('_')

const PANE_PROPS = {
  title: 'ForgeCenter', isFocused: false, bodyColumns: 80, placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 }, view: {},
} as const

// Engine operations a test answers with { value }.
// What a blocked call carries: { deny } here, or an errored result's text.
const refusal = (r: { deny?: string; text?: string }) => r.deny ?? r.text ?? ''

const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

// A clock that moves forward a second each time it's read.
const ticking = (on: any, from = 1_000_000) => { let t = from; on('clock.now', () => ({ value: (t += 1000) })) }

// Fake git: answers by which subcommand ran. `staged` is the file list, `diff` the zero-context diff.
const fakeGit = (on: any, { staged = '', diff = '', log = '' }: { staged?: string; diff?: string; log?: string }) =>
  on('process.run', ($: unknown, e: { argv: string[] }) => {
    const a = e.argv
    if (a.includes('rev-parse')) return ok('/repo\n')
    if (a.includes('log')) return ok(a.includes('-p') ? log : '')
    if (a.includes('-U0')) return ok(diff)
    if (a.includes('--name-only')) return ok(a.includes('--cached') ? staged : '')
    return ok('')
  })

const diffAdding = (file: string, ...added: string[]) =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -0,0 +1,${added.length} @@\n${added.map(l => `+${l}`).join('\n')}\n`

// Real-looking secrets, assembled at run time so this file never contains one.
const LIVE_STRIPE = ['sk', 'live', '51Hx' + 'a'.repeat(30)].join('_')
const ANTHROPIC = ['sk', 'ant', 'api03', 'x'.repeat(40)].join('-')

describe('secrets guard', () => {
  test('stops a commit that would include .env', async ($, on) => {
    let ran = false
    ticking(on)
    on('process.run', ($, e) => ok(e.argv.includes('--cached') ? '.env\nsrc/app.js\n' : ''))
    on('tool.call', () => { ran = true; return { result: { stdout: '', stderr: '' }, text: '' } })
    const r = await $.tool.call({ tool: 'Bash', command: 'git add -A && git commit -m "launch"' })
    expect(refusal(r)).toContain('.env holds secrets or customer data')
    expect(ran).toBe(false)
  })

  test('stops a push of commits that contain the customer database', async ($, on) => {
    ticking(on)
    on('process.run', ($, e) => ok(e.argv.includes('log') ? 'src/app.js\ndata/forgecenter.db\n' : ''))
    on('tool.call', () => ({ result: { stdout: '', stderr: '' }, text: 'pushed' }))
    const r = await $.tool.call({ tool: 'Bash', command: 'git push -u origin main' })
    expect(refusal(r)).toContain('data/forgecenter.db')
  })

  test('stops a commit whose changes contain a real-looking key, without repeating the key', async ($, on) => {
    let ran = false
    ticking(on)
    fakeGit(on, { staged: 'README.md\n', diff: diffAdding('README.md', 'Setup notes', `STRIPE_SECRET_KEY=${LIVE_STRIPE}`) })
    on('tool.call', () => { ran = true; return { result: {}, text: '' } })
    const r = await $.tool.call({ tool: 'Bash', command: 'git commit -am "notes"' })
    expect(refusal(r)).toContain('README.md:2 (Stripe secret or restricted key)')
    expect(refusal(r)).not.toContain(LIVE_STRIPE)
    expect(ran).toBe(false)
  })

  test('stops a push whose commits add a key', async ($, on) => {
    ticking(on)
    fakeGit(on, { log: diffAdding('src/ai.js', `const key = "${ANTHROPIC}"`) })
    on('tool.call', () => ({ result: {}, text: 'pushed' }))
    const r = await $.tool.call({ tool: 'Bash', command: 'git push origin feature' })
    expect(refusal(r)).toContain('src/ai.js:1 (Anthropic API key)')
  })

  test('lets placeholders and safe commits through, including .env.example', async ($, on) => {
    ticking(on)
    fakeGit(on, {
      staged: '.env.example\nREADME.md\ntemplates/discord-bot/.env.example\n',
      diff: diffAdding('.env.example', 'STRIPE_SECRET_KEY=rk_test_...', 'ANTHROPIC_API_KEY=sk-ant-...', 'PTERODACTYL_APP_KEY=ptla_...'),
    })
    on('tool.call', () => ({ result: { stdout: 'committed', stderr: '' }, text: 'committed' }))
    const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m "docs"' })
    expect(r.text).toBe('committed')
  })

  test('leaves other commands alone', async ($, on) => {
    let gitCalls = 0
    ticking(on)
    on('process.run', () => { gitCalls += 1; return ok() })
    on('tool.call', () => ({ result: { stdout: 'hi', stderr: '' }, text: 'hi' }))
    const r = await $.tool.call({ tool: 'Bash', command: 'echo hi' })
    expect(r.text).toBe('hi')
    expect(gitCalls).toBe(0)
  })
})

describe('tests before commits', () => {
  const PASSING = 'TAP version 13\n# tests 89\n# pass 89\n# fail 0\n'

  test('stops a commit of changed code until a full test run passes after the change', async ($, on) => {
    ticking(on)
    fakeGit(on, { staged: 'src/wallet.js\nREADME.md\n' })
    let mtime = 0
    on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: mtime, isLink: false } }))
    const outputs: Record<string, string> = { 'npm test': PASSING, 'npm test -- test/wallet.test.js': PASSING, 'git commit -m "fix"': 'committed' }
    on('tool.call', ($, e) => ({ result: {}, text: outputs[(e as { command: string }).command] ?? '' }))

    // No passing run yet in this session.
    expect(refusal(await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix"' }))).toContain("haven't passed in this session")
    // A run of one file doesn't count.
    await $.tool.call({ tool: 'Bash', command: 'npm test -- test/wallet.test.js' })
    expect(refusal(await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix"' }))).toContain('src/wallet.js')
    // A full passing run after the change does.
    mtime = 1_000_500
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix"' })).text).toBe('committed')
    // Editing again afterwards needs another run.
    mtime = 99_000_000
    expect(refusal(await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix"' }))).toContain('since the tests last passed')
  })

  test('a failing run never counts', async ($, on) => {
    ticking(on)
    fakeGit(on, { staged: 'public/js/common.js\n' })
    on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 0, isLink: false } }))
    on('tool.call', ($, e) => ({ result: {}, text: (e as { command: string }).command === 'npm test' ? '# pass 80\n# fail 2\n' : 'committed' }))
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(refusal(await $.tool.call({ tool: 'Bash', command: 'git commit -m "ui"' }))).toContain('public/js/common.js')
  })

  test('commits without tested code need no test run', async ($, on) => {
    ticking(on)
    fakeGit(on, { staged: 'README.md\npublic/terms.html\n' })
    on('tool.call', () => ({ result: {}, text: 'committed' }))
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m "docs"' })).text).toBe('committed')
  })
})

describe('project rules guard', () => {
  // Stands in for the tools themselves, noting which ones actually ran.
  const runs = (calls: string[]) => (_: unknown, e: { tool: string }) => { calls.push(e.tool); return { result: {}, text: 'done' } }

  test('stops server code that passes payment_method_types to Stripe', async ($, on) => {
    const calls: string[] = []
    on('tool.call', runs(calls))
    const r = await $.tool.call({ tool: 'Edit', file_path: '/repo/src/orders.js',
      old_string: 'mode, line_items, customer,', new_string: "mode, line_items, customer, payment_method_types: ['card'],", replace_all: false })
    expect(refusal(r)).toContain('dynamic payment methods')
    expect(calls).toEqual([])
  })

  test('stops a schema that stores a date of birth', async ($, on) => {
    const calls: string[] = []
    on('tool.call', runs(calls))
    on('fs.read', () => ({ value: 'export const db = 1\n' }))
    const r = await $.tool.call({ tool: 'Write', file_path: '/repo/src/db.js',
      content: 'db.exec(`ALTER TABLE users ADD COLUMN date_of_birth TEXT`)\n' })
    expect(refusal(r)).toContain('stores a date of birth')
    expect(calls).toEqual([])
  })

  test('lets tests, reading a verified birth date, and existing code through', async ($, on) => {
    const calls: string[] = []
    on('tool.call', runs(calls))
    await $.tool.call({ tool: 'Edit', file_path: '/repo/test/fake-stripe.js',
      old_string: 'x', new_string: 'assert.equal(body.payment_method_types, undefined)', replace_all: false })
    await $.tool.call({ tool: 'Edit', file_path: '/repo/src/age.js',
      old_string: 'const dob = null', new_string: 'const dob = vs.verified_outputs?.dob', replace_all: false })
    // Moving a line that already mentions it doesn't add a new use.
    await $.tool.call({ tool: 'Edit', file_path: '/repo/src/legacy.js',
      old_string: 'a; // payment_method_types', new_string: 'b; // payment_method_types', replace_all: false })
    expect(calls).toEqual(['Edit', 'Edit', 'Edit'])
  })
})

describe('status line', () => {
  test('shows the latest test result', async ($, on) => {
    const lines: (string | undefined)[] = []
    ticking(on)
    on('ui.status', ($, e) => { lines.push(e.text); return { value: undefined } })
    on('tool.call', () => ({ result: { stdout: '', stderr: '' }, text: 'TAP version 13\n# tests 53\n# pass 51\n# fail 2\n' }))
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(lines.at(-1)).toBe('ForgeCenter tests: 2 failing')
  })
})

describe('launch check pane', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`reports missing settings without ever showing secret values (${surface})`, { timeoutMs: 10000 }, async ($, on) => {
      on('fs.read', ($, e) => {
        if (e.path.endsWith('/.env') || e.path === '.env') {
          return { value: [
            'BASE_URL=https://forgecenter.net', 'GOOGLE_CLIENT_ID=real-id.apps.googleusercontent.com',
            'ADMIN_EMAILS=owner@forgecenter.net', `STRIPE_SECRET_KEY=${FAKE_STRIPE}`, 'STRIPE_WEBHOOK_SECRET=',
            'ANTHROPIC_API_KEY=sk-ant-...', 'SECRET_KEY=too-short', 'CONTACT_EMAIL=help@forgecenter.net',
            `RESEND_API_KEY=${FAKE_RESEND}`, 'EMAIL_FROM=ForgeCenter <orders@forgecenter.net>',
          ].join('\n') }
        }
        if (e.path.endsWith('package.json')) return { value: '{ "name": "forgecenter" }' }
        throw new Error(`unexpected read ${e.path}`)
      })
      on('process.run', ($, e) => e.argv[0] === 'npm'
        ? ok('# tests 53\n# pass 53\n# fail 0\n')
        : ok('## main...origin/main [ahead 2]\n M src/app.js\n'))
      on('ui.toast', () => ({ value: undefined }))
      on('clock.now', () => ({ value: 1_700_000_000_000 }))

      const ui = await $.ui.mount({ plugin: 'forgecenter', surface, component: 'Pane', requestId: 'forgecenter', props: PANE_PROPS })
      expect((await ui.find({ key: 'run' }))?.type).toBe('Button')
      await ui.press({ key: 'run' })

      const tree = JSON.stringify(await ui.drawn())
      expect(tree).toContain('Not ready yet: 3 required setting groups missing')
      expect(tree).toContain('Payments (Stripe): needs STRIPE_WEBHOOK_SECRET')
      expect(tree).toContain('AI mentor and help desk: needs ANTHROPIC_API_KEY')
      expect(tree).toContain('Bot token encryption: needs SECRET_KEY')
      expect(tree).toContain('Tests: all 53 passing')
      expect(tree).toContain('1 changed file, 2 commits not pushed')
      expect(tree).not.toContain(FAKE_STRIPE)
      expect(tree).not.toContain(FAKE_RESEND)
    })
  }
})
