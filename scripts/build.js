import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JavaScriptObfuscator from 'javascript-obfuscator';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

const entries = ['manifest.json', 'background', 'popup', 'icons'];

const obfuscationOptions = {
  compact: true,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.7,
  renameGlobals: false,
  renameProperties: false,
  keepClassNames: true,
  keepFunctionNames: true,
  reservedNames: [
    'buildBookmarksInfo',
    'buildPrompt',
    'chunkArray',
    'parseJsonResponse'
  ]
};

async function ensureCleanDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function copyEntry(src, dest) {
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const items = await fs.readdir(src);
    for (const item of items) {
      await copyEntry(path.join(src, item), path.join(dest, item));
    }
    return;
  }

  if (src.endsWith('.js')) {
    const code = await fs.readFile(src, 'utf8');
    const obfuscated = JavaScriptObfuscator.obfuscate(code, obfuscationOptions).getObfuscatedCode();
    await fs.writeFile(dest, obfuscated, 'utf8');
    return;
  }

  await fs.copyFile(src, dest);
}

async function build() {
  await ensureCleanDir(distDir);
  for (const entry of entries) {
    await copyEntry(path.join(rootDir, entry), path.join(distDir, entry));
  }
}

build().catch(error => {
  console.error('Build failed:', error);
  process.exit(1);
});
