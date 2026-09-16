/**
 * Builds the .vsix from a staging directory.
 *
 * Packaging from the working tree produced a 45 MB extension containing 7,800
 * files. The cause was this project's `.npmrc`, which sets `include=dev` to
 * work around NODE_ENV being production on the development machine: vsce asks
 * npm what the dependencies are, npm answered "all of them", and the build
 * toolchain went into the package.
 *
 * Staging removes the whole class of problem. The directory contains exactly
 * what ships, its dependencies are installed fresh with dev omitted, and the
 * developer's own npm configuration cannot reach it.
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stage = join(root, 'build', 'vsix')
const out = join(root, 'build')

console.log('staging in', stage)
await rm(stage, { recursive: true, force: true })
await mkdir(stage, { recursive: true })

for (const item of ['dist', 'media', 'README.md', 'CHANGELOG.md', 'LICENSE.md', 'PRIVACY.md']) {
  await cp(join(root, item), join(stage, item), { recursive: true }).catch(() => {
    console.warn(`  (skipped ${item}, not present)`)
  })
}

// Source maps are for debugging a checkout, not for shipping.
await rm(join(stage, 'dist', 'extension.js.map'), { force: true })
await rm(join(stage, 'dist', 'verify.js'), { force: true })
await rm(join(stage, 'dist', 'verify.js.map'), { force: true })

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
delete pkg.scripts
delete pkg.devDependencies
await writeFile(join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')

/*
 * The install is isolated from the developer's npm config in two ways, because
 * one is not enough: `npm run` exports every npm setting as an npm_config_*
 * environment variable, so the child inherits them whatever --userconfig says.
 */
const emptyConfig = join(tmpdir(), 'suprasuta-vsix-empty.npmrc')
await writeFile(emptyConfig, '')
await writeFile(join(stage, '.npmrc'), 'omit=dev\n')

console.log('installing runtime dependencies…')
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--userconfig', emptyConfig], {
  cwd: stage,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.toLowerCase().startsWith('npm_config_'))
    ),
    NODE_ENV: 'production'
  }
})

await rm(join(stage, 'package-lock.json'), { force: true })
await rm(join(stage, '.npmrc'), { force: true })
await rm(emptyConfig, { force: true })

console.log('packaging…')
execFileSync(
  'node',
  [
    join(root, 'node_modules', '@vscode', 'vsce', 'vsce'),
    'package',
    '--out',
    join(out, `${pkg.name}-${pkg.version}.vsix`),
    '--allow-missing-repository'
  ],
  { cwd: stage, stdio: 'inherit' }
)
