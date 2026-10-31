import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cwd, env } from 'node:process';

const projectRoot = cwd();
const tempDirectory = mkdtempSync(join(tmpdir(), 'mdeditor-kit-package-'));
const npmEnvironment = { ...env, npm_config_cache: join(tempDirectory, 'npm-cache') };

const run = (command, args, cwd) => {
  execFileSync(command, args, { cwd, env: npmEnvironment, stdio: 'inherit' });
};

try {
  const packed = execFileSync(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', tempDirectory],
    { cwd: projectRoot, encoding: 'utf8', env: npmEnvironment },
  );
  const [{ filename }] = JSON.parse(packed);
  const tarball = join(tempDirectory, filename);

  writeFileSync(
    join(tempDirectory, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  run(
    'npm',
    ['install', '--ignore-scripts', '--legacy-peer-deps', '--no-package-lock', tarball],
    tempDirectory,
  );

  // Link the project's react copy so the package's peer dependency resolves.
  const nodeModules = join(tempDirectory, 'node_modules');
  mkdirSync(nodeModules, { recursive: true });
  for (const peer of ['react', 'react-dom', 'react/jsx-runtime']) {
    const name = peer.replace('/jsx-runtime', '');
    const target = join(projectRoot, 'node_modules', name);
    const link = join(nodeModules, name);
    try {
      symlinkSync(target, link, 'dir');
    } catch {
      // already exists (npm may have created an entry), skip
    }
  }

  const packageName = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).name;
  // The package is ESM only, so every entry is checked through import.
  const imports = [`await import('${packageName}')`, `await import('${packageName}/core')`];
  for (const source of imports) {
    run('node', ['--input-type=module', '--eval', source], tempDirectory);
  }

  // A consumer's bundler resolves both entries and their dependencies.
  writeFileSync(
    join(tempDirectory, 'index.html'),
    '<div id="root"></div><script type="module" src="/main.js"></script>',
  );
  writeFileSync(
    join(tempDirectory, 'main.js'),
    [
      `import { isFormat } from '${packageName}';`,
      `import { parseMarkdown, serializeHtml } from '${packageName}/core';`,
      "document.getElementById('root').textContent = String(isFormat('bold')) + serializeHtml(parseMarkdown('# a').blocks);",
    ].join('\n'),
  );
  run(
    'node',
    [join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'],
    tempDirectory,
  );
} finally {
  rmSync(tempDirectory, { force: true, recursive: true });
}
