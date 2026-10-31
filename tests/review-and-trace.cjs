const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')
const root = path.resolve(__dirname, '..')
function load(relative) {
  const filename = path.join(root, relative)
  const compiled = esbuild.buildSync({ entryPoints: [filename], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' }).outputFiles[0].text
  const module = new Module(filename, require.main)
  module.filename = filename
  module.paths = Module._nodeModulePaths(path.dirname(filename))
  module._compile(compiled, filename)
  return module.exports
}

test('terminal replay keeps edits and line boundaries, removes control sequences', () => {
  const { normalizeTerminalInput } = load('src/shared/terminalInput.ts')
  assert.equal(normalizeTerminalInput('3\r10\r2x\x7f0\r30\r'), '3\n10\n20\n30\n')
  assert.equal(normalizeTerminalInput('12\x1b[D3\r'), '132\n')
  assert.equal(normalizeTerminalInput('\x1b[200~hello\x1b[201~\r\n'), 'hello\n')
})

test('normalization attributes before/after changes to the executed line and array cell', () => {
  const { normalizeVisualizationTrace } = load('src/main/execution/traceNormalizer.ts')
  const trace = normalizeVisualizationTrace([
    { line: 2, action: 'input', function: 'main', frameId: 'main-1', variablesBefore: { arr: '[?, ?, ?]' }, locals: { arr: '[10, ?, ?]' }, inputs: [{ target: 'arr[0]', value: '10' }], stdout: '' },
    { line: 5, action: 'loop', function: 'main', frameId: 'main-1', variablesBefore: { i: '3' }, locals: { i: '3' }, condition: 'i < n', conditionResult: false, iteration: 3, stdout: '' }
  ], 'int main() {\ncin >> arr[i];\n}', 'cpp', '3\n10\n')
  assert.deepEqual(trace[0].changes, [{ name: 'arr[0]', before: '?', after: '10', kind: 'updated' }])
  assert.equal(trace[0].inputTarget, 'arr[0]')
  assert.match(trace[0].beginnerText, /10.*arr\[0\]/)
  assert.equal(trace[1].iteration, 3)
  assert.match(trace[1].beginnerText, /false.*3 passes/)
})

test('AI review accepts only the current file snapshot, reject and identical content are safe', () => {
  const memory = new Map()
  global.localStorage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) }
  global.window = { localStorage: global.localStorage }
  const { useEditorStore: store } = load('src/renderer/src/state/editorStore.ts')
  store.getState().createNewFile('cpp')
  const id = store.getState().activeFileId
  store.getState().updateContent(id, 'int value = 1;')
  const proposal = { fileId: id, originalContent: 'int value = 1;', modifiedContent: 'int value = 2;', isApplying: false }
  store.getState().setAiDiff(proposal)
  store.getState().rejectAiDiff()
  assert.equal(store.getState().openFiles[0].content, 'int value = 1;')
  store.getState().setAiDiff(proposal)
  store.getState().acceptAiDiff()
  assert.equal(store.getState().openFiles[0].content, 'int value = 2;')
  store.getState().setAiDiff(proposal)
  assert.equal(store.getState().aiDiff, null)
  store.getState().setAiDiff({ ...proposal, originalContent: 'int value = 2;', modifiedContent: 'int value = 3;' })
  store.getState().updateContent(id, 'int value = 4;')
  store.getState().acceptAiDiff()
  assert.equal(store.getState().openFiles[0].content, 'int value = 4;')
})
