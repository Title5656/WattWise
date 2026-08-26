import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const symbolIcons = ['⌁', '◒', '♢', '◎', '◫', '⌂', '⚙', '☰', '＋', '⌕', '✦', '↗', '→', '›', '‹'];

export function findSymbolIcons(source) {
  const found = symbolIcons.filter((symbol) => source.includes(symbol));
  if (/[^<]*>\s*×\s*</.test(source)) found.push('×');
  return found;
}

function tsxFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? tsxFiles(path) : extname(path) === '.tsx' ? [path] : [];
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const violations = tsxFiles('app').flatMap((file) =>
    findSymbolIcons(readFileSync(file, 'utf8')).map((symbol) => `${file}: ${symbol}`),
  );
  if (violations.length) {
    console.error(`Symbol-based icons found:\n${violations.join('\n')}`);
    process.exitCode = 1;
  }
}
