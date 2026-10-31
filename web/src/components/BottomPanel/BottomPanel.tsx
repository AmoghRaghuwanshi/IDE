import { useExecutionStore } from '../../state/executionStore'
import { useEditorStore } from '../../state/editorStore'
import TerminalPanel from '../Terminal/TerminalPanel'
import ErrorsPanel from '../ErrorsPanel/ErrorsPanel'

export default function BottomPanel() {
  const activeTab = useExecutionStore((s) => s.activeBottomTab)
  const setActiveTab = useExecutionStore((s) => s.setActiveBottomTab)
  const errors = useEditorStore((s) => s.errors)

  const errorCount = errors.filter((e) => e.severity === 'error').length
  const warningCount = errors.filter((e) => e.severity === 'warning').length
  const totalBadge = errorCount + warningCount

  return (
    <div className="app-bottom-panel">
      <div className="panel-tabs no-select">
        <button
          className={`panel-tab ${activeTab === 'output' ? 'active' : ''}`}
          onClick={() => setActiveTab('output')}
        >
          ▶ Output
        </button>
        <button
          className={`panel-tab ${activeTab === 'errors' ? 'active' : ''}`}
          onClick={() => setActiveTab('errors')}
        >
          ⚠ Problems
          {totalBadge > 0 && <span className="panel-tab-badge">{totalBadge}</span>}
        </button>
      </div>
      <div className="panel-content">
        {activeTab === 'output' ? <TerminalPanel /> : <ErrorsPanel />}
      </div>
    </div>
  )
}
