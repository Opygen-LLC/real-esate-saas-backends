// Adapter-level tests execute the actual TypeScript modules, not copied business rules.
// Database/provider doubles do not replace the replica-set integration release gate.
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
const ts = require(process.env.PHASE1_TYPESCRIPT_PATH || 'typescript');
const root = path.resolve(__dirname, '../..');
function load(relative, dependencies = {}) {
  const filename = path.resolve(root, relative);
  const source = fs.readFileSync(filename, 'utf8');
  const js = ts.transpileModule(source, { fileName: filename, compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  }, reportDiagnostics: true });
  const errors = (js.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: f => f, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
  const module = { exports: {} };
  const scopedRequire = id => {
    if (Object.prototype.hasOwnProperty.call(dependencies, id)) return dependencies[id];
    if (id.startsWith('node:') || ['crypto', 'net', 'url', 'path'].includes(id)) return require(id);
    throw new Error(`Unstubbed dependency ${id} in ${relative}`);
  };
  new vm.Script(`(function(require,module,exports,__filename,__dirname){${js.outputText}\n})`, { filename })
    .runInThisContext()(scopedRequire, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}
const ApiError = load('src/errors/ApiError.ts').default;
const errorDependency = { __esModule: true, default: ApiError };
function query(value, events = [], label = 'query') {
  const q = { select() { return q; }, lean() { return q; }, session(session) { events.push([label, session]); return q; },
    sort() { return q; }, limit() { return q; }, then(resolve, reject) { return Promise.resolve(typeof value === 'function' ? value() : value).then(resolve, reject); } };
  return q;
}
module.exports = { load, query, ApiError, errorDependency, root };
