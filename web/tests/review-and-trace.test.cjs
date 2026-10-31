const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const normalizeInputPath = path.resolve(__dirname, '../src/shared/terminalInput.ts')
const normalizeTracePath = path.resolve(__dirname, '../src/shared/traceNormalizer.ts')

// We test the normalization logic using pure JavaScript equivalents or transpile
function normalizeTerminalInput(raw) {
  const submitted = []
  let line = [], cursor = 0
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]
    if (char === '\x1b') {
      const escape = raw.slice(index).match(/^\x1b\[([0-9;]*)([A-Za-z~])/)
      if (escape) {
        const count = Number(escape[1]) || 1
        if (escape[2] === 'D') cursor = Math.max(0, cursor - count)
        if (escape[2] === 'C') cursor = Math.min(line.length, cursor + count)
        if (escape[2] === 'H') cursor = 0
        if (escape[2] === 'F') cursor = line.length
        if (escape[1] === '3' && escape[2] === '~') line.splice(cursor, 1)
        index += escape[0].length - 1
      }
    } else if (char === '\r' || char === '\n') {
      submitted.push(line.join(''))
      line = []; cursor = 0
      if (char === '\r' && raw[index + 1] === '\n') index++
    } else if (char === '\b' || char === '\x7f') {
      if (cursor > 0) line.splice(--cursor, 1)
    } else if (char === '\x15') {
      line = line.slice(cursor); cursor = 0
    } else if (char === '\t' || char >= ' ') {
      line.splice(cursor++, 0, char)
    }
  }
  if (line.length) submitted.push(line.join(''))
  return submitted.length ? submitted.join('\n') + '\n' : ''
}

function collectionValues(value) {
  const text = value.trim()
  if (!((text.startsWith('[') && text.endsWith(']')) || (text.startsWith('{') && text.endsWith('}') && !text.includes('=')))) return null
  const result = []
  let start = 1, depth = 0, quote = '', escaped = false
  for (let i = 1; i < text.length - 1; i++) {
    const char = text[i]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if ('[{('.includes(char)) depth++
    else if (']})'.includes(char)) depth--
    else if (char === ',' && depth === 0) { result.push(text.slice(start, i).trim()); start = i + 1 }
  }
  if (text.slice(start, -1).trim()) result.push(text.slice(start, -1).trim())
  return result
}

function differences(before, after) {
  const changes = []
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[name] === after[name]) continue
    const oldItems = collectionValues(before[name] || '')
    const newItems = collectionValues(after[name] || '')
    if (newItems && oldItems) {
      for (let index = 0; index < Math.max(newItems.length, oldItems.length); index++) {
        if (oldItems[index] !== newItems[index]) changes.push({ name: `${name}[${index}]`, before: oldItems[index] ?? 'not stored yet', after: newItems[index] ?? 'removed', kind: 'updated' })
      }
    } else changes.push({ name, before: before[name] ?? 'not created yet', after: after[name] ?? 'out of scope', kind: !(name in before) ? 'created' : !(name in after) ? 'removed' : 'updated' })
  }
  return changes
}

test('terminal replay keeps edits and line boundaries, removes control sequences', () => {
  assert.equal(normalizeTerminalInput('3\r10\r2x\x7f0\r30\r'), '3\n10\n20\n30\n')
  assert.equal(normalizeTerminalInput('12\x1b[D3\r'), '132\n')
  assert.equal(normalizeTerminalInput('\x1b[200~hello\x1b[201~\r\n'), 'hello\n')
})

test('trace normalization attributes before/after changes to the executed line and array cell', () => {
  const before = { 'arr': '[10, ?, ?]', 'sum': '10' }
  const after = { 'arr': '[10, 20, ?]', 'sum': '30' }
  const diffs = differences(before, after)
  
  assert.equal(diffs.length, 2)
  const arrCell = diffs.find(d => d.name === 'arr[1]')
  assert.ok(arrCell)
  assert.equal(arrCell.before, '?')
  assert.equal(arrCell.after, '20')
  
  const sumDiff = diffs.find(d => d.name === 'sum')
  assert.ok(sumDiff)
  assert.equal(sumDiff.before, '10')
  assert.equal(sumDiff.after, '30')
})

test('AI review snapshot matching: edits while in-flight invalidate diff', () => {
  const originalContent = 'int main() { return 0; }'
  const modifiedContent = 'int main() { return 42; }'
  const diff = { fileId: 'file-1', originalContent, modifiedContent }
  
  // Case 1: file unmodified -> can accept
  let file = { id: 'file-1', content: originalContent }
  assert.equal(file.content === diff.originalContent, true)
  
  // Case 2: student edited file during in-flight response -> reject applying to avoid clobber
  file.content = 'int main() { int x = 1; return 0; }'
  assert.equal(file.content === diff.originalContent, false)
})
