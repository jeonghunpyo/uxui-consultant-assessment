import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'site');
const outputDir = path.join(root, 'offline');
const entries = [
  { html: 'index.html', js: 'exam.js', output: '시험지.html' },
  { html: 'grading.html', js: 'grading.js', output: '채점작업실.html' },
  { html: 'results.html', js: 'results.js', output: '결과확인.html' },
];

// This project uses only named imports and named function/const exports.
// Keep the bundler deliberately limited: unsupported syntax must fail the build.
async function bundle(entry) {
  const names = new Map();
  const visiting = new Set();
  const chunks = [];
  async function visit(filename) {
    if (visiting.has(filename)) throw new Error(`Circular module: ${filename}`);
    if (names.has(filename)) return names.get(filename);
    if (!/^[a-z-]+\.js$/.test(filename)) throw new Error(`Unsupported module path: ${filename}`);
    visiting.add(filename);
    let source = await readFile(path.join(sourceDir, filename), 'utf8');
    const imports = [...source.matchAll(/^import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/([a-z-]+\.js)['"];?/gm)];
    for (const match of imports) {
      const dependency = await visit(match[2]);
      const imported = match[1].split(',').map(name => name.trim()).filter(Boolean);
      if (imported.some(name => !/^\w+(?:\s+as\s+\w+)?$/.test(name))) throw new Error(`Unsupported import in ${filename}`);
      const bindings = imported.map(name => name.replace(/\s+as\s+/, ': ')).join(', ');
      source = source.replace(match[0], `const { ${bindings} } = ${dependency};`);
    }
    const exports = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map(match => match[1]);
    source = source.replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|class)\s)/gm, '');
    if (/^(?:import|export)\s/m.test(source)) throw new Error(`Unsupported module syntax in ${filename}`);
    const name = `__uxui_module_${names.size}`;
    names.set(filename, name);
    visiting.delete(filename);
    chunks.push(`const ${name} = (() => {\n${source}\nreturn { ${exports.join(', ')} };\n})();`);
    return name;
  }
  await visit(entry);
  return `'use strict';\n${chunks.join('\n\n')}`;
}

await mkdir(outputDir, { recursive: true });
const css = await readFile(path.join(sourceDir, 'styles.css'), 'utf8');
for (const entry of entries) {
  let html = await readFile(path.join(sourceDir, entry.html), 'utf8');
  const js = await bundle(entry.js);
  html = html.replace(/<link rel="stylesheet" href="(?:\.\/)?styles\.css">/, `<style>\n${css}\n</style>`);
  html = html.replace(/<script type="module" src="[^\"]+"><\/script>/, () => `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`);
  for (const item of entries) html = html.replaceAll(`href="${item.html}"`, `href="${item.output}"`).replaceAll(`href="./${item.html}"`, `href="${item.output}"`);
  if (entry.js === 'exam.js') {
    // The exam is delivered on its own. Do not leave navigation to missing files.
    html = html.replace(/<nav class="nav"[\s\S]*?<\/nav>/, '<span class="muted">오프라인 시험지 · 파일로 전달</span>');
    html = html.replace(/<p><a href="결과확인\.html">[\s\S]*?<\/p>/, '<p>채점용 JSON 파일을 담당자에게 전달해 주세요.</p>');
    html = html.replace('href="시험지.html"', 'href="#"');
  }
  if (/<(?:script|link)[^>]+(?:src|href)=/.test(html)) throw new Error(`External dependency remains in ${entry.output}`);
  await writeFile(path.join(outputDir, entry.output), html);
  console.log(`Built offline/${entry.output} (${Buffer.byteLength(html)} bytes)`);
}
