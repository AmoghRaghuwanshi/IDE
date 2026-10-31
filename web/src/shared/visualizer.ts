export interface VariableChange {
  name: string
  before: string
  after: string
  kind: 'created' | 'updated' | 'removed'
}

export interface VisualizerFrame {
  id: string
  name: string
  line: number
  locals: Record<string, string>
}

export interface NormalizedVisualizerStep {
  id: number
  event: string
  action: string
  line: number
  source: string
  function: string
  frameId: string
  frames: VisualizerFrame[]
  locals: Record<string, string>
  variablesBefore: Record<string, string>
  changes: VariableChange[]
  description: string
  beginnerText: string
  why: string
  nextAction: string
  inputs: { target: string; value: string }[]
  inputValue?: string
  inputTarget?: string
  inputPrompt?: string
  iteration?: number
  condition?: string
  conditionResult?: boolean | null
  stdout: string
  outputText?: string
  error?: string
  isImportant: boolean
}

export interface RunSnapshot {
  fileId: string
  name: string
  language: 'c' | 'cpp' | 'python'
  content: string
}
