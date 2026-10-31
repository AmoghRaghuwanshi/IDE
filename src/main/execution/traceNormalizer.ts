import type { NormalizedVisualizerStep, VariableChange, VisualizerFrame } from '../../shared/visualizer'

function record(value: unknown): Record<string, string> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).map(([name, item]) => [name, String(item)])) : {}
}

// Tokenize container values without splitting commas in strings/nested containers.
export function collectionValues(value: string): string[] | null {
  const text = value.trim()
  if (!((text.startsWith('[') && text.endsWith(']')) || (text.startsWith('{') && text.endsWith('}') && !text.includes('=')))) return null
  const result: string[] = []
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

function differences(before: Record<string, string>, after: Record<string, string>): VariableChange[] {
  const changes: VariableChange[] = []
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

export function normalizeVisualizationTrace(rawTrace: Record<string, unknown>[], sourceCode: string, _language: string, _input: string): NormalizedVisualizerStep[] {
  const sourceLines = sourceCode.split(/\r?\n/)
  let previousOutput = ''
  const previousByFrame = new Map<string, Record<string, string>>()
  return rawTrace.filter(raw => raw && typeof raw === 'object').map((raw, index) => {
    const line = Math.max(0, Number(raw.line) || 0)
    const source = String(raw.source ?? sourceLines[line - 1] ?? '')
    const functionName = String(raw.function || '<module>')
    const frameId = String(raw.frameId || functionName)
    const locals = record(raw.locals)
    const before = raw.variablesBefore ? record(raw.variablesBefore) : previousByFrame.get(frameId) || {}
    previousByFrame.set(frameId, locals)
    const changes = differences(before, locals)
    const action = raw.event === 'exception' ? 'exception' : String(raw.action || raw.event || 'execute')
    const inputs = Array.isArray(raw.inputs) ? raw.inputs.filter(item => item && typeof item === 'object').map(item => ({ target: String(item.target || 'input'), value: String(item.value ?? '') })) : []
    const conditionResult = typeof raw.conditionResult === 'boolean' ? raw.conditionResult : null
    const condition = typeof raw.condition === 'string' ? raw.condition : undefined
    const iteration = typeof raw.iteration === 'number' ? raw.iteration : undefined
    const stdout = typeof raw.stdout === 'string' ? raw.stdout : previousOutput
    const outputText = stdout.startsWith(previousOutput) ? stdout.slice(previousOutput.length) : stdout
    previousOutput = stdout
    let title = 'The program executed this line.'
    let why = 'Statements run in the order selected by the program.'
    if (action === 'input') {
      title = inputs.length ? inputs.map(item => `You entered ${item.value}. It was stored in ${item.target}.`).join(' ') : 'The program reached an input statement.'
      why = 'This statement reads values from the input recorded during your run.'
    } else if (action === 'loop') {
      title = conditionResult === false ? `The loop condition is false. The loop has completed ${iteration ?? 0} passes.` : `The loop condition is true. Pass ${iteration ?? 1} starts now.`
      why = condition ? `The program checked: ${condition}.` : 'The loop checks whether there is another pass to run.'
    } else if (action === 'condition') {
      title = conditionResult === null ? 'The program checked a condition.' : conditionResult ? 'The condition is true. The matching branch runs.' : 'The condition is false. This branch is skipped.'
      why = condition ? `The decision was made using: ${condition}.` : 'The program chooses the next statement based on this decision.'
    } else if (action === 'call') {
      title = `The program entered ${String(raw.calledFunction || functionName)}.`
      why = 'This function gets its own local variables. The caller waits until it returns.'
    } else if (action === 'return') {
      title = `${functionName} finished${raw.return_value !== undefined ? ` and returned ${String(raw.return_value)}` : ''}.`
      why = 'Execution continues in the function that called it.'
    } else if (action === 'exception') {
      title = String(raw.error || 'The program encountered an error.')
      why = 'Inspect the highlighted line and the values available at this step.'
    } else if (action === 'output') {
      title = outputText ? 'The program printed the text shown below.' : 'The program executed an output statement.'
      why = 'The output panel contains everything printed up to this step.'
    } else if (changes.length) {
      title = changes.slice(0, 3).map(change => `${change.name} changed from ${change.before} to ${change.after}.`).join(' ')
      why = action === 'declaration' ? 'This statement creates variables in the current function.' : `The program executed: ${source}`
    }
    const frames: VisualizerFrame[] = Array.isArray(raw.frames) ? raw.frames.map(frame => ({ id: String(frame.id), name: String(frame.name), line: Number(frame.line) || 0, locals: record(frame.locals) })) : [{ id: frameId, name: functionName, line, locals }]
    const nextLine = Number(raw.nextLine) || 0
    return { id: index + 1, event: String(raw.event || 'line'), action, line, source,
      function: functionName, frameId, frames, locals, variablesBefore: before, changes,
      description: title, beginnerText: title, why,
      nextAction: nextLine > 0 ? `Continue at line ${nextLine}.` : action === 'exception' ? 'Review this error before running again.' : 'Continue playback to see the next recorded action.',
      inputs, inputValue: inputs[0]?.value, inputTarget: inputs[0]?.target,
      inputPrompt: typeof raw.inputPrompt === 'string' ? raw.inputPrompt : undefined,
      iteration, condition, conditionResult, stdout, outputText,
      error: typeof raw.error === 'string' ? raw.error : undefined,
      isImportant: action !== 'execute' || changes.length > 0 || !!outputText }
  })
}
