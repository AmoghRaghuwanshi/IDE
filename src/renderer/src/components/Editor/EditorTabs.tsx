import { useEditorStore } from '../../state/editorStore'

function getLanguageIcon(lang: string): { label: string; className: string } {
  switch (lang) {
    case 'c':
      return { label: 'C', className: 'tab-icon c' }
    case 'cpp':
      return { label: 'C++', className: 'tab-icon cpp' }
    case 'python':
      return { label: 'Py', className: 'tab-icon python' }
    default:
      return { label: '?', className: 'tab-icon' }
  }
}

export default function EditorTabs() {
  const openFiles = useEditorStore((s) => s.openFiles)
  const activeFileId = useEditorStore((s) => s.activeFileId)
  const setActiveFile = useEditorStore((s) => s.setActiveFile)
  const closeFile = useEditorStore((s) => s.closeFile)

  if (openFiles.length === 0) return <div className="tab-bar" />

  return (
    <div className="tab-bar no-select">
      {openFiles.map((file) => {
        const icon = getLanguageIcon(file.language)
        const isActive = file.id === activeFileId

        return (
          <div
            key={file.id}
            className={`tab ${isActive ? 'active' : ''}`}
            onClick={() => setActiveFile(file.id)}
            title={file.path || file.name}
          >
            <span className={icon.className}>{icon.label}</span>
            <span className="truncate">{file.name}</span>
            {file.isDirty && <span className="tab-dirty" />}
            <span
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation()
                closeFile(file.id)
              }}
              title="Close"
            >
              ✕
            </span>
          </div>
        )
      })}
    </div>
  )
}
