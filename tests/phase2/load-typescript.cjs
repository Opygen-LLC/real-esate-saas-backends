// Execute the real source modules. This does NOT replace dependency-installed typechecks or Mongo/browser integration.
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
const ts = require(process.env.PHASE2_TYPESCRIPT_PATH || 'typescript');
const root = path.resolve(__dirname, '../..');
function createLoader(base = root, dependencies = {}) {
  const cache = new Map();
  function load(input, parent = path.join(base, '__entry__.ts')) {
    if (Object.hasOwn(dependencies, input)) return dependencies[input];
    if (input.startsWith('node:')) return require(input);
    let filename = input.startsWith('@/') ? path.join(base, input.slice(2)) : input.startsWith('.') ? path.resolve(path.dirname(parent), input) : path.resolve(base, input);
    const candidate = [filename, `${filename}.ts`, `${filename}.tsx`, path.join(filename, 'index.ts')].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    if (!candidate || !candidate.startsWith(base + path.sep)) throw new Error(`Unresolved non-isolated dependency: ${input} from ${parent}`);
    filename = candidate;
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const source = fs.readFileSync(filename, 'utf8');
    const result = ts.transpileModule(source, { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
    const errors = result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error);
    if (errors.length) throw new Error(ts.formatDiagnostics(errors, { getCanonicalFileName: f => f, getCurrentDirectory: () => base, getNewLine: () => '\n' }));
    new vm.Script(`(function(require,module,exports,__filename,__dirname){${result.outputText}\n})`, { filename }).runInThisContext()(id => load(id, filename), module, module.exports, filename, path.dirname(filename));
    return module.exports;
  }
  return load;
}
module.exports = { createLoader, load: createLoader(), root, ts };
