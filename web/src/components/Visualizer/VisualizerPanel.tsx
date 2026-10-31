import { useEffect, useMemo, useRef, useState } from 'react'
import type { NormalizedVisualizerStep, VisualizerFrame } from '../../shared/visualizer'
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
          <div className="viz-button-group">
            <button onClick={() => setStep(0)} disabled={step === 0}>⏮ First</button>
            <button onClick={() => previous !== undefined && setStep(previous)} disabled={previous === undefined}>◀ Previous</button>
            <button onClick={() => setPlaying(!playing)}>{playing ? '⏸ Pause' : '▶ Play'}</button>
            <button onClick={() => next !== undefined && setStep(next)} disabled={next === undefined}>Next ▶</button>
            <button onClick={() => setStep(trace.length - 1)} disabled={step === trace.length - 1}>Last ⏭</button>
          </div>
          <div className="viz-button-group">
            <label>Speed <select value={speed} onChange={e => setSpeed(Number(e.target.value))}>
              <option value={2000}>0.5x</option>
              <option value={1000}>1x</option>
              <option value={500}>2x</option>
            </select></label>
            <label>Show <select value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="important">Key steps</option>
              <option value="all">Every line</option>
              <option value="input">Inputs</option>
              <option value="changes">Changed variables</option>
              <option value="decisions">Decisions & loops</option>
              <option value="output">Prints</option>
            </select></label>
            <button onClick={() => setShowFlow(!showFlow)}>{showFlow ? 'Hide chart' : 'Show chart'}</button>
          </div>
        </nav>
        <section className="viz-explanation" aria-live="polite">
          <p className="viz-pill">{current.action.toUpperCase()}</p>
          <h3>{current.description}</h3>
          <p>{current.why}</p>
          <p className="viz-next">{current.nextAction}</p>
        </section>
        <main className="viz-grid">
          <section className="viz-panel">
            <h3>Variables in {frame?.name || 'current function'}</h3>
            {frames.length > 1 && <div className="viz-frames">{frames.map(item => <button key={item.id} className={item.id === frame?.id ? 'active' : ''} onClick={() => setSelectedFrame(item.id)}>{item.name}() line {item.line}</button>)}</div>}
            <div className="viz-variables">
              {scalars.length === 0 && arrays.length === 0 ? <p className="viz-empty">No variables stored here yet.</p> : null}
              {scalars.map(([name, value]) => {
                const change = current.changes.find(c => c.name === name)
                return <div key={name} className={`viz-card ${change ? 'highlight' : ''}`}>
                  <span className="viz-name">{name}</span>
                  <span className="viz-value">{humanValue(String(value))}</span>
                  {change && <span className="viz-change">Was {change.before}</span>}
                </div>
              })}
              {arrays.map(array => <div key={array.name} className="viz-card viz-array">
                <span className="viz-name">{array.name}</span>
                <div className="viz-cells">{array.values.map((value, index) => {
                  const change = current.changes.find(c => c.name === `${array.name}[${index}]`)
                  return <div key={index} className={`viz-cell ${change ? 'highlight' : ''}`}>
                    <span className="viz-index">[{index}]</span>
                    <span className="viz-value">{humanValue(value)}</span>
                  </div>
                })}</div>
              </div>)}
            </div>
          </section>
          <section className="viz-panel">
            <h3>Inputs & Decisions</h3>
            <div className="viz-lists">
              <div>
                <h4>Inputs you provided</h4>
                {inputHistory.length === 0 ? <p className="viz-empty">No input read yet.</p> : inputHistory.map((item, idx) => <p key={idx} className="viz-item">Entered <strong>{item.value}</strong> for <code>{item.target}</code></p>)}
              </div>
              <div>
                <h4>Loops & Branches</h4>
                {loops.size === 0 && !current.condition ? <p className="viz-empty">No loops executed yet.</p> : null}
                {[...loops.values()].map((loop, idx) => <p key={idx} className="viz-item">Line {loop.line} in {loop.name}(): {loop.passes} pass(es) complete ({loop.result === false ? 'finished' : 'looping'})</p>)}
              </div>
            </div>
          </section>
          <section className="viz-panel">
            <h3>Program Terminal Output</h3>
            <pre className="viz-output">{current.stdout || 'No output printed yet.'}</pre>
          </section>
        </main>
      </>}
  </div>
}
