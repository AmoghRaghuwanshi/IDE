// Capture the real app without exporting its saved API keys.
const { WebSocket } = require('undici')
const fs = require('node:fs')
const path = require('node:path')
let socket, id = 0
const pending = new Map()
function command(method, params = {}) {
  const request = ++id
  return new Promise((resolve, reject) => { pending.set(request, { resolve, reject }); socket.send(JSON.stringify({ id: request, method, params })) })
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result?.value
}
async function screenshot() {
  const result = await command('Page.captureScreenshot', { format: 'png' })
  const output = path.resolve(__dirname, '../test-results/gemini-context-assistant.png')
  fs.writeFileSync(output, Buffer.from(result.data, 'base64'))
  console.log('Screenshot saved: ' + output)
}
;(async () => {
  const pages = await (await fetch('http://127.0.0.1:9348/json/list')).json()
  const page = pages.find(item => item.type === 'page' && item.url.includes('index.html'))
  if (!page) throw new Error('CodeForge window was not found')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise(resolve => socket.addEventListener('open', resolve))
  socket.addEventListener('message', event => { const result = JSON.parse(event.data); if (result.id) { const request = pending.get(result.id); pending.delete(result.id); result.error ? request?.reject(result.error) : request?.resolve(result.result) } })
  await command('Page.enable')
  const mode = process.argv[2] || 'inspect'
  if (mode === 'inspect') {
    console.log(await evaluate(`(() => {
      document.querySelector('.modal-overlay')?.click();
      const ai = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '✨ AI');
      ai?.click();
      let keyCount = 0;
      try { const keys = JSON.parse(localStorage.getItem('codeforge_gemini_keys') || '[]'); keyCount = Array.isArray(keys) ? keys.filter(key => typeof key === 'string' && key.trim()).length : 0 } catch {}
      return JSON.stringify({configuredKeys: keyCount});
    })()`))
  } else if (mode === 'describe') {
    console.log(await evaluate(`JSON.stringify({buttons: [...document.querySelectorAll('button')].map(button => button.textContent.trim()), inputs: [...document.querySelectorAll('input')].map(input => ({placeholder:input.placeholder,type:input.type}))})`))
  } else if (mode === 'ask') {
    console.log(await evaluate(`(() => {
      const input = document.querySelector('input[placeholder="Ask about your code…"]');
      if (!input) return 'Chat input is unavailable';
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'Explain the code currently open in the editor in two simple sentences. Mention the variable names and what it prints.');
      input.dispatchEvent(new Event('input', {bubbles:true}));
      return 'Prompt ready';
    })()`))
  } else if (mode === 'send') {
    console.log(await evaluate(`(() => { const send = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Send'); if (!send || send.disabled) return 'Send is not ready'; send.click(); return 'Gemini request submitted'; })()`))
  } else if (mode === 'capture') {
    await screenshot()
  } else if (mode === 'status') {
    console.log(await evaluate(`JSON.stringify({waiting:document.body.innerText.includes('Thinking…'),chatText:document.querySelector('.chatbot-panel')?.innerText.slice(-2400) || 'Chat panel not found'})`))
  }
})().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => socket?.close())
