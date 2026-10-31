// Run after npm run build. Uses a temporary profile, never the user's files/keys.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { WebSocket } = require('undici')
const root = path.resolve(__dirname, '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'codeforge-ui-check-'))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const executable = env.CODEFORGE_TEST_EXECUTABLE || require('electron')
const appArgs = [...(env.CODEFORGE_TEST_EXECUTABLE ? [] : [root]), '--remote-debugging-port=9347', '--user-data-dir=' + profile]
const app = spawn(executable, appArgs, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const errors = []
app.stderr.on('data', data => { if (data.toString().includes('Error')) errors.push(data.toString().slice(0, 500)) })
let socket, sequence = 0, pageLoaded
const requests = new Map()
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, timeout = 35000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { const result = await fn(); if (result) return result; await delay(150) }
  throw new Error('Timed out waiting for UI state')
}
function send(method, params = {}) {
  const id = ++sequence
  return new Promise((resolve, reject) => { requests.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result?.value
}
async function screenshot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png' })
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true })
  fs.writeFileSync(path.join(root, 'test-results', name + '.png'), Buffer.from(result.data, 'base64'))
}
function clickText(label) {
  return evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(label)}); if (!button || button.disabled) return false; button.click(); return true })()`)
}
async function seed(content, language = 'cpp') {
  const file = { id: 'smoke-file', path: 'untitled:///smoke.' + (language === 'cpp' ? 'cpp' : 'py'), name: 'smoke.' + (language === 'cpp' ? 'cpp' : 'py'), language, content, savedContent: content, isDirty: false }
  await evaluate(`localStorage.setItem('codeforge-editor-storage', ${JSON.stringify(JSON.stringify({ state: { openFiles: [file], activeFileId: file.id, workingDirectory: null }, version: 0 }))})`)
  const loaded = new Promise(resolve => { pageLoaded = resolve })
  await send('Page.reload')
  await Promise.race([loaded, delay(20000).then(() => { throw new Error('Reload did not finish') })])
  await until(() => evaluate(`!!document.querySelector('.monaco-editor textarea')`))
  await evaluate(`document.querySelector('.modal-overlay')?.click()`)
  await delay(400)
}
async function pasteInEditor(text) {
  await until(() => evaluate(`!!document.querySelector('.monaco-editor textarea') && !document.querySelector('.monaco-diff-editor')`))
  // The editor's React onMount runs just after Monaco inserts its textarea.
  await delay(300)
  await evaluate(`(() => { const target = document.querySelector('.monaco-editor textarea'); target.focus(); const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify(text)}); target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); })()`)
  await until(() => evaluate(`!!document.querySelector('.monaco-diff-editor')`))
  await until(() => evaluate(`(() => { const view = document.querySelector('.monaco-diff-editor .modified'); const text = view?.textContent.replace(/\\u00a0/g, ' ') || ''; return /value\\s*=\\s*1/.test(text) && /value\\s*=\\s*2/.test(text) })()`))
}

;(async () => {
  const target = await until(async () => {
    try { return (await (await fetch('http://127.0.0.1:9347/json/list')).json()).find(item => item.type === 'page' && item.url.includes('index.html')) } catch { return null }
  })
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => socket.addEventListener('open', resolve))
  socket.addEventListener('message', event => {
    const result = JSON.parse(event.data)
    if (result.id) { const pending = requests.get(result.id); requests.delete(result.id); result.error ? pending?.reject(result.error) : pending?.resolve(result.result) }
    if (result.method === 'Page.loadEventFired') { pageLoaded?.(); pageLoaded = null }
    if (result.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(result.params.exceptionDetails))
  })
  await send('Runtime.enable'); await send('Page.enable')
  const before = '#include <iostream>\nint main() {\n    int value = 1;\n    std::cout << value;\n    return 0;\n}\n'
  const after = before.replace('value = 1', 'value = 2')
  await seed(before)
  await pasteInEditor(after)
  assert.equal(await evaluate(`document.body.innerText.includes('Red: previous code') && document.body.innerText.includes('Green: proposed code')`), true)
  await screenshot('ai-change-review')
  assert.equal(await clickText('Reject'), true)
  await until(() => evaluate(`!document.querySelector('.monaco-diff-editor')`))
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('codeforge-editor-storage')).state.openFiles[0].content`), before)
  await pasteInEditor(after)
  assert.equal(await clickText('Accept'), true)
  await until(() => evaluate(`!document.querySelector('.monaco-diff-editor')`))
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('codeforge-editor-storage')).state.openFiles[0].content`), after)
  console.log('PASS: pasted-code red/green review, Reject preserves original, Accept applies proposal')

  const program = 'def add(value, other):\n    result = value + other\n    return result\n\ndef main():\n    n = int(input("Count: "))\n    arr = [0] * n\n    total = 0\n    for i in range(n):\n        arr[i] = int(input())\n        total = add(total, arr[i])\n    print("Total:", total)\n\nmain()\n'
  await seed(program, 'python')
  await until(() => evaluate(`(() => { const button = document.querySelector('button[title="Run (F5)"]'); if (!button || button.disabled) return false; button.click(); return true })()`))
  await until(() => evaluate(`!!document.querySelector('.xterm-rows')?.textContent.includes('Count:')`))
  await evaluate(`(() => { const target = document.querySelector('.xterm-helper-textarea'); target.focus(); const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify('3\n10\n20\n30\n')}); target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); })()`)
  await until(() => evaluate(`!!document.querySelector('.xterm-rows')?.textContent.includes('Total: 60')`))
  await until(() => evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.includes('Visualize')); if (!button || button.disabled) return false; button.click(); return true })()`))
  await until(() => evaluate(`!!document.querySelector('.viz-explanation')`), 60000)
  for (let i = 0; i < 100; i++) {
    if (await evaluate(`!!document.querySelector('.viz-input-event')?.textContent.includes('arr[1]')`)) break
    if (!await clickText('Next step')) throw new Error('Array input step was not found')
    await delay(50)
  }
  assert.equal(await evaluate(`document.querySelector('.viz-explanation').textContent.includes('arr[1]')`), true)
  await screenshot('visualizer-array-input')
  let foundFunction = false
  for (let i = 0; i < 100; i++) {
    if (await evaluate(`document.querySelector('.viz-eyebrow')?.textContent.startsWith('add')`)) { foundFunction = true; break }
    if (!await clickText('Next step')) break
    await delay(40)
  }
  assert.equal(foundFunction, true)
  await screenshot('visualizer-function-state')
  await clickText('Last')
  await delay(150)
  assert.equal(await evaluate(`document.querySelector('.viz-learning').textContent.includes('Total: 60')`), true)
  assert.equal(await evaluate(`!!document.querySelector('.viz-flow')`), false)
  await clickText('Show flowchart')
  assert.equal(await evaluate(`!!document.querySelector('.viz-flow')`), true)
  console.log('PASS: terminal input capture, replay, array destination, helper function frames, final output, optional flowchart')
  await clickText('Close visualizer')
  const cpp = fs.readFileSync(path.join(__dirname, 'test_visualizer.py'), 'utf8').match(/CPP = '''([\s\S]*?)'''/)[1]
  await seed(cpp, 'cpp')
  await until(() => evaluate(`(() => { const button = document.querySelector('button[title="Run (F5)"]'); if (!button || button.disabled) return false; button.click(); return true })()`))
  await until(() => evaluate(`!!document.querySelector('.xterm-rows')?.textContent.includes('Count:')`))
  await evaluate(`(() => { const target = document.querySelector('.xterm-helper-textarea'); target.focus(); const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify('3\n10\n20\n30\n')}); target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); })()`)
  await until(() => evaluate(`!!document.querySelector('.xterm-rows')?.textContent.includes('Total: 60')`))
  await until(() => evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.includes('Visualize')); if (!button || button.disabled) return false; button.click(); return true })()`))
  await until(() => evaluate(`!!document.querySelector('.viz-explanation')`), 60000)
  for (let i = 0; i < 150; i++) {
    if (await evaluate(`!!document.querySelector('.viz-input-event')?.textContent.includes('arr[1]')`)) break
    if (!await clickText('Next step')) throw new Error('C++ array input step was not found')
    await delay(40)
  }
  assert.equal(await evaluate(`document.querySelector('.viz-explanation').textContent.includes('arr[1]')`), true)
  await screenshot('visualizer-cpp-array-input')
  await clickText('Last')
  await delay(100)
  assert.equal(await evaluate(`document.querySelector('.viz-learning').textContent.includes('Total: 60')`), true)
  console.log('PASS: C++ terminal execution and GDB replay through the actual Electron UI')
  await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false })
  await delay(100)
  assert.equal(await evaluate(`document.querySelector('.codeforge-visualizer').scrollWidth <= window.innerWidth`), true)
  await screenshot('visualizer-compact-window')
  assert.deepEqual(errors.filter(error => !/ERR_INTERNET_DISCONNECTED|ERR_CERT|GPU|Autofill/.test(error)), [])
  console.log('PASS: no renderer exceptions')
})().catch(async error => { console.error(error); console.error('Renderer diagnostics:', errors); try { await screenshot('ui-failure') } catch {} process.exitCode = 1 }).finally(() => { socket?.close(); app.kill() })
