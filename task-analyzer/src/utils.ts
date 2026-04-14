/**
 * Task Analyzer — Utilities
 * Logger, subprocess exec, workspace management, Fernet decrypt
 */

import { execFile, spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ─── Logger ───
export const log = {
  info: (msg: string) => process.stderr.write(`[task-analyzer] ${msg}\n`),
  warn: (msg: string) => process.stderr.write(`[task-analyzer] WARN: ${msg}\n`),
  error: (msg: string) => process.stderr.write(`[task-analyzer] ERROR: ${msg}\n`),
  debug: (msg: string) => {
    if (process.env.DEBUG) process.stderr.write(`[task-analyzer] DEBUG: ${msg}\n`);
  },
};

// ─── Subprocess Execution ───
export async function exec(
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number; env?: Record<string, string> }
): Promise<{ stdout: string; stderr: string }> {
  const timeout = options?.timeout ?? 120_000;
  const env = { ...process.env, ...options?.env };

  try {
    const result = await execFileAsync(command, args, {
      cwd: options?.cwd,
      timeout,
      env,
      maxBuffer: 50 * 1024 * 1024, // 50MB
    });
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  } catch (err: any) {
    const stdout = err.stdout ?? '';
    const stderr = err.stderr ?? err.message;
    throw new Error(`Command failed: ${command} ${args.join(' ')}\n${stderr}\n${stdout}`);
  }
}

/**
 * Spawn a long-running process and capture output.
 */
export function spawnProcess(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Process exited with code ${code}: ${stderr}`));
    });

    proc.on('error', reject);
  });
}

// ─── Workspace Management ───
const WORKSPACE_ROOT = join(tmpdir(), 'task-analyzer');

export function createWorkspace(projectId?: string): {
  projectId: string;
  repoPath: string;
  docsPath: string;
} {
  const id = projectId ?? generateId();
  const base = join(WORKSPACE_ROOT, id);
  const repoPath = join(base, 'repo');
  const docsPath = join(base, '.docs');

  for (const dir of [
    repoPath,
    join(docsPath, 'specs'),
    join(docsPath, 'parsed'),
    join(docsPath, 'pageindex'),
    join(docsPath, 'issues'),
    join(docsPath, 'output'),
  ]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  return { projectId: id, repoPath, docsPath };
}

export function getWorkspace(projectId: string) {
  const base = join(WORKSPACE_ROOT, projectId);
  if (!existsSync(base)) throw new Error(`Project ${projectId} not found`);
  return {
    projectId,
    repoPath: join(base, 'repo'),
    docsPath: join(base, '.docs'),
  };
}

function generateId(): string {
  return randomBytes(6).toString('hex');
}

// ─── Local Module Paths ───
// Resolve relative to task-analyzer package root (src/../..)
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Root of the project_analyzer monorepo */
const MONOREPO_ROOT = join(__dirname, '..', '..');

/**
 * Build chain config — ORDER MATTERS:
 * 1. gitnexus (build script auto-builds gitnexus-shared first)
 * 2. task-master (independent, uses tsdown bundler)
 *
 * NOTE: gitnexus/scripts/build.js runs `npx tsc` on gitnexus-shared
 * internally, so we only need to ensure shared has node_modules.
 */
interface ModuleConfig {
  /** Display name for logs */
  name: string;
  /** Root directory containing package.json */
  root: string;
  /** Binary entry point to check if built */
  bin: string;
  /** Directory containing node_modules */
  nodeModulesDir: string;
  /** npm install args */
  installArgs?: string[];
  /** Extra directories that need node_modules before this module builds */
  preInstallDirs?: { root: string; nodeModulesDir: string }[];
}

const BUILD_CHAIN: ModuleConfig[] = [
  {
    name: 'gitnexus',
    root: join(MONOREPO_ROOT, 'git-nexus', 'gitnexus'),
    bin: join(MONOREPO_ROOT, 'git-nexus', 'gitnexus', 'dist', 'cli', 'index.js'),
    nodeModulesDir: join(MONOREPO_ROOT, 'git-nexus', 'gitnexus', 'node_modules'),
    // --ignore-scripts: skip postinstall (we build explicitly via npm run build)
    installArgs: ['install', '--no-audit', '--no-fund', '--ignore-scripts'],
    // gitnexus build script needs gitnexus-shared/node_modules for `npx tsc`
    preInstallDirs: [
      {
        root: join(MONOREPO_ROOT, 'git-nexus', 'gitnexus-shared'),
        nodeModulesDir: join(MONOREPO_ROOT, 'git-nexus', 'gitnexus-shared', 'node_modules'),
      },
    ],
  },
  {
    name: 'task-master',
    root: join(MONOREPO_ROOT, 'task-master'),
    bin: join(MONOREPO_ROOT, 'task-master', 'dist', 'task-master.js'),
    nodeModulesDir: join(MONOREPO_ROOT, 'task-master', 'node_modules'),
    installArgs: ['install', '--no-audit', '--no-fund'],
  },
];

/** Exported for gitnexus.ts / taskmaster.ts */
export const LOCAL_MODULES = {
  gitnexus: {
    root: BUILD_CHAIN[0].root,
    bin: BUILD_CHAIN[0].bin,
  },
  taskmaster: {
    root: BUILD_CHAIN[1].root,
    bin: BUILD_CHAIN[1].bin,
  },
};

let _bootstrapped = false;

/**
 * Bootstrap: install + build all modules in correct dependency order.
 *
 * Runs ONCE on first tool call. For each module:
 *   1. Check node_modules/ → npm install if missing
 *   2. Check dist/<bin> → npm run build if missing
 *
 * Build order: gitnexus-shared → gitnexus → task-master
 * (gitnexus build script handles copying shared into its dist/)
 */
export async function bootstrap(): Promise<void> {
  if (_bootstrapped) return;

  log.info('[bootstrap] Checking local modules...');

  for (const mod of BUILD_CHAIN) {
    // ── Step 0: Install prerequisites (e.g. gitnexus-shared for gitnexus) ──
    if (mod.preInstallDirs) {
      for (const pre of mod.preInstallDirs) {
        if (!existsSync(pre.nodeModulesDir)) {
          log.info(`[bootstrap] ${mod.name}: installing prerequisite deps (${pre.root})...`);
          try {
            await exec('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], {
              cwd: pre.root,
              timeout: 300_000,
            });
          } catch (err: any) {
            log.error(`[bootstrap] prerequisite install failed — ${err.message}`);
            throw new Error(`Failed to install prerequisite for ${mod.name}: ${err.message}`);
          }
        }
      }
    }

    // ── Step 1: npm install (if node_modules missing) ──
    if (!existsSync(mod.nodeModulesDir)) {
      log.info(`[bootstrap] ${mod.name}: installing dependencies...`);
      try {
        const installArgs = mod.installArgs ?? ['install', '--no-audit', '--no-fund'];
        await exec('npm', installArgs, {
          cwd: mod.root,
          timeout: 300_000,
        });
        log.info(`[bootstrap] ${mod.name}: install complete ✓`);
      } catch (err: any) {
        log.error(`[bootstrap] ${mod.name}: install failed — ${err.message}`);
        throw new Error(`Failed to install ${mod.name}: ${err.message}`);
      }
    }

    // ── Step 2: npm run build (if binary missing) ──
    if (!existsSync(mod.bin)) {
      log.info(`[bootstrap] ${mod.name}: building...`);
      try {
        // Clean stale tsbuildinfo — composite TS projects skip rebuild
        // if tsbuildinfo exists but dist/ was deleted
        const tsBuildInfo = join(mod.root, 'tsconfig.tsbuildinfo');
        if (existsSync(tsBuildInfo)) {
          const { unlinkSync } = await import('fs');
          unlinkSync(tsBuildInfo);
        }
        // Also clean tsbuildinfo in preInstallDirs (e.g. gitnexus-shared)
        if (mod.preInstallDirs) {
          for (const pre of mod.preInstallDirs) {
            const preInfo = join(pre.root, 'tsconfig.tsbuildinfo');
            if (existsSync(preInfo)) {
              const { unlinkSync } = await import('fs');
              unlinkSync(preInfo);
            }
          }
        }

        await exec('npm', ['run', 'build'], {
          cwd: mod.root,
          timeout: 300_000,
        });

        // Verify binary was actually created
        if (!existsSync(mod.bin)) {
          throw new Error(`Build succeeded but binary not found at: ${mod.bin}`);
        }

        log.info(`[bootstrap] ${mod.name}: build complete ✓`);
      } catch (err: any) {
        log.error(`[bootstrap] ${mod.name}: build failed — ${err.message}`);
        throw new Error(`Failed to build ${mod.name}: ${err.message}`);
      }
    } else {
      log.info(`[bootstrap] ${mod.name}: already built ✓`);
    }
  }

  _bootstrapped = true;
  log.info('[bootstrap] All modules ready ✓');
}

/**
 * Force rebuild all modules (e.g. after git pull).
 * Clears cached state so next bootstrap() rebuilds everything.
 */
export function resetBootstrap(): void {
  _bootstrapped = false;
}

/**
 * Get the node command + args to run a local module binary.
 * Returns { cmd: 'node', prefix: ['/abs/path/to/dist/cli/index.js'] }
 */
export function getModuleBin(module: 'gitnexus' | 'taskmaster'): { cmd: string; prefix: string[] } {
  const mod = LOCAL_MODULES[module];
  return { cmd: 'node', prefix: [mod.bin] };
}

// ─── Fernet Decrypt ───
/**
 * Attempt to decrypt a Fernet-encrypted value.
 * Returns plaintext if encrypted, or original value if already plaintext.
 */
export function decryptIfNeeded(value: string): string {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) return value;

  // Fernet tokens are always base64url, ~120+ chars, starting with 'gAAAAA'
  if (!value.startsWith('gAAAAA') || value.length < 100) return value;

  try {
    // Dynamic import fernet (optional dependency)
    const fernet = require('fernet');
    const secret = new fernet.Secret(encryptionKey);
    const token = new fernet.Token({ secret, token: value, ttl: 0 });
    return token.decode();
  } catch {
    // Not encrypted or decryption failed — return as-is
    return value;
  }
}
