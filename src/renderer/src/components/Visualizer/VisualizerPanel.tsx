import { useEffect, useMemo, useRef, useState } from 'react'
import type { NormalizedVisualizerStep, VisualizerFrame } from '../../../../shared/visualizer'
import { useExecutionStore } from '../../state/executionStore'
import { useEditorStore } from '../../state/editorStore'
import './visualizer.css'

function items(value: string): string[] | null {
  const text = value.trim()
  if (!text.startsWith('[') || !text.endsWith(']')) return null
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
    else if (char === ',' && !depth) { result.push(text.slice(start, i).trim()); start = i + 1 }
  }
  if (text.slice(start, -1).trim()) result.push(text.slice(start, -1).trim())
  return result
}

function humanValue(value: string): string { return value === '?' ? 'Not recorded yet' : value }

export default function VisualizerPanel() {
  const visible = useExecutionStore(s => s.isVisualizerVisible)
  const rawTrace = useExecutionStore(s => s.visualizerTrace)
  const source = useExecutionStore(s => s.visualizerSource)
  const busy = useExecutionStore(s => s.isVisualizing)
  const rawStep = useExecutionStore(s => s.visualizerStep)
  const setStep = useExecutionStore(s => s.setVisualizerStep)
  const setVisible = useExecutionStore(s => s.setVisualizerVisible)
  const files = useEditorStore(s => s.openFiles)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1000)
  const [filter, setFilter] = useState('important')
  const [showFlow, setShowFlow] = useState(false)
  const [selectedFrame, setSelectedFrame] = useState('')
  const currentLine = useRef<HTMLDivElement>(null)
  const trace = useMemo(() => (rawTrace || []).filter(entry => entry && typeof entry === 'object').map((entry, index): NormalizedVisualizerStep => ({
    ...entry, id: index + 1, action: entry.action || entry.event || 'execute', line: Number(entry.line) || 0,
    locals: entry.locals && typeof entry.locals === 'object' ? entry.locals : {},
    variablesBefore: entry.variablesBefore || {}, inputs: Array.isArray(entry.inputs) ? entry.inputs : [],
    changes: Array.isArray(entry.changes) ? entry.changes : [], frames: Array.isArray(entry.frames) ? entry.frames : [],
    stdout: typeof entry.stdout === 'string' ? entry.stdout : '', function: entry.function || 'main', isImportant: entry.isImportant !== false
  })), [rawTrace])
  const step = Math.min(Math.max(0, rawStep), Math.max(0, trace.length - 1))
  const current = trace[step]
  const indexes = useMemo(() => trace.flatMap((entry, index) => {
    const match = filter === 'all' || filter === 'important' && entry.isImportant || filter === 'input' && entry.inputs.length > 0 || filter === 'changes' && entry.changes.length > 0 || filter === 'decisions' && ['loop', 'condition'].includes(entry.action) || filter === 'output' && !!entry.outputText
    return match || entry.action === 'exception' ? [index] : []
  }), [trace, filter])
  const next = indexes.find(index => index > step)
  const previous = [...indexes].reverse().find(index => index < step)
  useEffect(() => {
    if (!playing || !visible) return
    if (next === undefined) { setPlaying(false); return }
    const timer = setTimeout(() => setStep(next), speed)
    return () => clearTimeout(timer)
  }, [playing, visible, next, speed, setStep])
  useEffect(() => { setPlaying(false); setSelectedFrame('') }, [rawTrace])
  useEffect(() => { currentLine.current?.scrollIntoView({ block: 'center', behavior: 'auto' }) }, [step])
  useEffect(() => {
    if (!visible) return
    const handler = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input,textarea,select,button')) return
      if (event.key === 'Escape') { setPlaying(false); setVisible(false) }
      if (event.key === 'ArrowRight' && next !== undefined) { event.preventDefault(); setPlaying(false); setStep(next) }
      if (event.key === 'ArrowLeft' && previous !== undefined) { event.preventDefault(); setPlaying(false); setStep(previous) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [visible, previous, next, setStep, setVisible])
  if (!visible) return null
  const history = trace.slice(0, step + 1)
  const inputHistory = history.flatMap(entry => entry.inputs.map(input => ({ ...input, line: entry.line, function: entry.function })))
  const loops = new Map<string, { line: number; name: string; passes: number; result: boolean | null | undefined }>()
  for (const entry of history) {
    if (entry.action === 'loop') loops.set(`${entry.frameId}:${entry.line}`, { line: entry.line, name: entry.function, passes: entry.iteration ?? 0, result: entry.conditionResult })
  }
  const frames: VisualizerFrame[] = current?.frames.length ? current.frames : current ? [{ id: current.frameId || 'current', name: current.function, line: current.line, locals: current.locals }] : []
  const frame = frames.find(item => item.id === selectedFrame) || frames.find(item => item.id === current?.frameId) || frames[0]
  const locals = frame?.locals || {}
  const arrays = Object.entries(locals).flatMap(([name, value]) => { const values = items(String(value)); return values ? [{ name, values }] : [] })
  const scalars = Object.entries(locals).filter(([, value]) => !items(String(value)))
  const edited = !!source && files.some(file => file.id === source.fileId && file.content !== source.content)
  return <div className="codeforge-visualizer" role="dialog" aria-modal="true" aria-label="Execution visualizer">
    <header className="viz-header">
      <div><h2>See your program run</h2><p>{source?.name || 'Execution replay'} · {busy ? 'Recording the execution' : `${trace.length} recorded steps`}</p></div>
      <button onClick={() => { setPlaying(false); setVisible(false) }}>Close visualizer</button>
    </header>
    {edited && <p className="viz-notice">You changed this file after running it. This playback shows the saved run. Run again to visualize your edits.</p>}
    {busy ? <div className="viz-loading" role="status"><h3>Recording your program with your input</h3><p>Collecting function calls, variable changes, loop decisions, and terminal output. This may take a moment.</p></div>
      : !current ? <div className="viz-loading"><h3>No execution was recorded</h3><p>Run your code, enter its input in the terminal, then choose Visualize.</p></div>
      : <>
        <nav className="viz-controls" aria-label="Playback controls">
          <button disabled={step === 0} onClick={() => { setPlaying(false); setStep(0) }}>First</button>
          <button disabled={previous === undefined} onClick={() => { setPlaying(false); if (previous !== undefined) setStep(previous) }}>Previous</button>
          <button className="viz-primary" disabled={next === undefined && !playing} onClick={() => setPlaying(value => !value)}>{playing ? 'Pause' : 'Play'}</button>
          <button disabled={next === undefined} onClick={() => { setPlaying(false); if (next !== undefined) setStep(next) }}>Next step</button>
          <button disabled={step === trace.length - 1} onClick={() => { setPlaying(false); setStep(trace.length - 1) }}>Last</button>
          <label>Show <select value={filter} onChange={event => { setPlaying(false); setFilter(event.target.value) }}>
            <option value="important">Important steps</option><option value="all">Every recorded step</option><option value="input">Inputs</option><option value="changes">Value changes</option><option value="decisions">Loops and decisions</option><option value="output">Output</option>
          </select></label>
          <label>Speed <select value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value={1600}>Slow</option><option value={1000}>Normal</option><option value={350}>Fast</option></select></label>
          <button aria-pressed={showFlow} onClick={() => setShowFlow(value => !value)}>{showFlow ? 'Hide flowchart' : 'Show flowchart'}</button>
        </nav>
        <div className="viz-progress"><label htmlFor="viz-progress">Step {step + 1} of {trace.length}</label><input id="viz-progress" type="range" min="0" max={Math.max(0, trace.length - 1)} value={step} onChange={event => { setPlaying(false); setStep(Number(event.target.value)) }} /></div>
        <main className={`viz-workspace${showFlow ? ' with-flow' : ''}`}>
          <section className="viz-source" aria-label="Source for this run"><h3>Code from this run</h3><div className="viz-code-scroll">
            {(source?.content || '').split(/\r?\n/).map((text, index) => <div key={index} ref={index + 1 === current.line ? currentLine : undefined} className={`viz-code-line${index + 1 === current.line ? ' current' : ''}`} aria-current={index + 1 === current.line ? 'step' : undefined}><span>{index + 1}</span><code>{text || ' '}</code></div>)}
          </div></section>
          <section className="viz-learning" aria-label="Current execution state">
            <article className={`viz-explanation${current.error ? ' error' : ''}`} aria-live="polite">
              <p className="viz-eyebrow">{current.function} · {current.line ? `Line ${current.line}` : 'Program status'} · {current.action}</p>
              <h3>{current.beginnerText || current.description || current.error || 'The program executed this step.'}</h3>
              {current.error ? <p role="alert">{current.error}</p> : <><p><strong>Why:</strong> {current.why}</p><p><strong>Next:</strong> {current.nextAction}</p></>}
              {current.condition && <div className="viz-decision"><code>{current.condition}</code><strong>{current.conditionResult === true ? 'True: continue into the body' : current.conditionResult === false ? 'False: leave or skip the body' : 'Result was not recorded'}</strong>{current.action === 'loop' && <span>Completed or started passes: {current.iteration ?? 0}</span>}</div>}
              {current.inputs.map((input, index) => <div className="viz-input-event" key={index}><span>You entered <strong>{input.value || '(empty input)'}</strong></span><span>Stored in <code>{input.target}</code></span></div>)}
              {!!current.outputText && <><p>Printed during this step:</p><pre className="viz-output">{current.outputText}</pre></>}
            </article>
            <section className="viz-values"><h3>What changed on this line</h3>{current.changes.length ? <div className="viz-table-scroll"><table><thead><tr><th>Variable or cell</th><th>Before</th><th>Now</th></tr></thead><tbody>{current.changes.map((change, index) => <tr key={index}><th><code>{change.name}</code></th><td>{humanValue(change.before)}</td><td className="viz-new-value">{humanValue(change.after)}</td></tr>)}</tbody></table></div> : <p className="viz-muted">No stored value changed during this step.</p>}</section>
            <section className="viz-values"><h3>Functions and their variables</h3><p className="viz-muted">The active function is shown first. Select a caller to inspect the values it is holding.</p>
              <div className="viz-frame-tabs" role="group" aria-label="Functions on the call stack">{frames.map((item, index) => <button key={item.id} aria-pressed={item.id === frame?.id} onClick={() => setSelectedFrame(item.id)}>{item.name === '<module>' ? 'Program' : item.name}{index === 0 ? ' (active)' : ' (waiting)'}</button>)}</div>
              {scalars.length ? <table><thead><tr><th>Variable</th><th>Current value in {frame?.name}</th></tr></thead><tbody>{scalars.map(([name, value]) => <tr key={name}><th><code>{name}</code></th><td>{String(value)}</td></tr>)}</tbody></table> : !arrays.length && <p className="viz-muted">This function has no recorded variables yet.</p>}
              {arrays.map(array => <ArrayState key={`${frame?.id}:${array.name}`} name={array.name} values={array.values} changedNames={current.frameId === frame?.id ? current.changes.map(change => change.name) : []} />)}
            </section>
            <details className="viz-details"><summary>Loop progress ({loops.size} loops observed)</summary>{[...loops.values()].map((loop, index) => <p key={index}>{loop.name}, line {loop.line}: {loop.passes} passes. {loop.result === false ? 'The last check ended the loop.' : 'The last check entered the body.'}</p>)}</details>
            <details className="viz-details"><summary>Your input history ({inputHistory.length} values used)</summary>{inputHistory.length ? <table><thead><tr><th>Input</th><th>Stored in</th><th>Where</th></tr></thead><tbody>{inputHistory.map((input, index) => <tr key={index}><td>{input.value}</td><td><code>{input.target}</code></td><td>{input.function}, line {input.line}</td></tr>)}</tbody></table> : <p>No input has been consumed at this point.</p>}</details>
            <section className="viz-values"><h3>Terminal output up to this step</h3><pre className="viz-output">{current.stdout || 'The program has not printed anything yet.'}</pre></section>
          </section>
          {showFlow && <SourceFlowchart source={source?.content || ''} currentLine={current.line} />}
        </main>
      </>}
  </div>
}

function ArrayState({ name, values, changedNames }: { name: string; values: string[]; changedNames: string[] }) {
  const [expanded, setExpanded] = useState(false)
  const lastWritten = values.findLastIndex(value => value !== '?')
  const count = expanded ? values.length : Math.min(values.length, Math.max(3, Math.min(24, lastWritten + 1)))
  return <div className="viz-array"><h4><code>{name}</code> <span>{values.length} recorded cells</span></h4>
    <div className="viz-array-cells">{values.slice(0, count).map((value, index) => {
      const changed = changedNames.includes(`${name}[${index}]`) || changedNames.includes(name)
      return <div key={index} className={changed ? 'changed' : ''}><span>Index {index}</span><strong title={humanValue(value)}>{value === '?' ? 'Unknown' : value}</strong><small>{changed ? 'Changed now' : 'Stored value'}</small></div>
    })}</div>
    <p className="viz-muted">Index 0 is the first cell. Unknown means this cell has not been recorded as written.</p>
    {values.length > count && <button onClick={() => setExpanded(true)}>Show all {values.length} recorded cells</button>}
    {expanded && values.length > 24 && <button onClick={() => setExpanded(false)}>Show fewer cells</button>}
  </div>
}

// This optional overview uses source blocks once; playback only changes emphasis.
function SourceFlowchart({ source, currentLine }: { source: string; currentLine: number }) {
  const { nodes, edges } = useMemo(() => {
    const lines = source.split(/\r?\n/)
    const nodes = lines.flatMap((text, index) => {
    const content = text.trim()
    if (!content || /^[{};]+$/.test(content) || /^#|^using\b|^\/\//.test(content)) return []
    const decision = /^(?:else\s+)?if\b|^(?:for|while)\b/.test(content)
    const input = /\bcin\b|\binput\s*\(|\bscanf\s*\(/.test(content)
    const output = /\bcout\b|\bprint\s*\(|\bprintf\s*\(/.test(content)
    return [{ line: index + 1, content, decision, io: input || output, loop: /^(for|while)\b/.test(content) }]
    })
    const edges: { from: number; to: number; label: string; side: boolean }[] = []
    const successor = new Map<number, number>()
    nodes.forEach((_, index) => { if (index + 1 < nodes.length) successor.set(index, index + 1) })
    const blockEnd = (line: number) => {
      let depth = 0, opened = false
      for (let index = line - 1; index < lines.length; index++) {
        const clean = lines[index].replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/.*$/g, '')
        for (const char of clean) {
          if (char === '{') { depth++; opened = true }
          if (char === '}' && opened && --depth === 0) return index + 1
        }
        if (!opened && index > line - 1 && clean.trim() && clean.trim() !== '{') return index + 1
      }
      return line + 1
    }
    nodes.forEach((node, index) => {
      if (!node.decision) return
      const end = blockEnd(node.line)
      const after = nodes.findIndex(item => item.line > end)
      const bodyLast = nodes.findLastIndex(item => item.line > node.line && item.line <= end)
      if (index + 1 < nodes.length) edges.push({ from: index, to: index + 1, label: 'True', side: false })
      if (after >= 0) edges.push({ from: index, to: after, label: 'False', side: true })
      successor.delete(index)
      if (node.loop && bodyLast > index) {
        successor.delete(bodyLast)
        edges.push({ from: bodyLast, to: index, label: 'Repeat', side: true })
      } else if (after >= 0 && /^\}?\s*else\b/.test(nodes[after].content) && bodyLast > index) {
        const elseEnd = blockEnd(nodes[after].line)
        const join = nodes.findIndex(item => item.line > elseEnd)
        successor.delete(bodyLast)
        if (join >= 0) edges.push({ from: bodyLast, to: join, label: 'Continue', side: true })
      }
    })
    for (const [from, to] of successor) edges.push({ from, to, label: '', side: false })
    return { nodes, edges }
  }, [source])
  return <aside className="viz-flow"><h3>Program overview</h3><p className="viz-muted">Diamond: decision. Slanted box: input or output. Rectangle: statement.</p><svg viewBox={`0 0 360 ${100 + nodes.length * 96}`} role="img" aria-label="Source statement overview with decision and loop markers"><defs><marker id="viz-flow-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="currentColor" /></marker></defs>
    <ellipse cx="160" cy="22" rx="65" ry="18" /><text x="160" y="27" textAnchor="middle">Program start</text>
    {nodes.map((node, index) => { const y = 55 + index * 96; return <g key={node.line} className={node.line === currentLine ? 'active' : ''}>
      {index === 0 && <path d={`M160 ${y - 15} V${y}`} markerEnd="url(#viz-flow-arrow)" />}
      {node.decision ? <polygon points={`160,${y} 285,${y + 28} 160,${y + 56} 35,${y + 28}`} /> : node.io ? <polygon points={`50,${y} 280,${y} 265,${y + 56} 35,${y + 56}`} /> : <rect x="35" y={y} width="250" height="56" />}
      <text x="160" y={y + 22} textAnchor="middle">Line {node.line}</text><text x="160" y={y + 40} textAnchor="middle">{node.content.slice(0, 31)}</text>
    </g> })}
    {edges.map((edge, index) => {
      const fromY = 55 + edge.from * 96
      const toY = 55 + edge.to * 96
      const back = edge.to < edge.from
      const path = edge.side ? back ? `M35 ${fromY + 28} H14 V${toY + 28} H35` : `M285 ${fromY + 28} H335 V${toY - 8} H160 V${toY}` : `M160 ${fromY + 56} V${toY}`
      return <g key={index}><path d={path} markerEnd="url(#viz-flow-arrow)" />{edge.label && <text x={edge.side ? back ? 17 : 293 : 166} y={fromY + (edge.side ? 16 : 72)}>{edge.label}</text>}</g>
    })}
  </svg><p className="viz-muted">Use the main playback for actual branch results and loop passes.</p></aside>
}
