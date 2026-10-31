/** Convert terminal editing keystrokes into the lines actually submitted. */
export function normalizeTerminalInput(raw: string): string {
  const submitted: string[] = []
  let line: string[] = [], cursor = 0
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
