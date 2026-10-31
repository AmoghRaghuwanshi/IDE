import { useState } from 'react'
import { useEditorStore } from '../../state/editorStore'
import { platform } from '../../platform/remoteAdapter'
import type { LanguageId } from '../../shared/types'

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'c':
    case 'h':
      return '🔵'
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
      return '🟣'
    case 'py':
      return '🟢'
    default:
      return '📄'
  }
}

export default function FileTree() {
  const openFiles = useEditorStore((s) => s.openFiles)
  const activeFileId = useEditorStore((s) => s.activeFileId)
  const setActiveFile = useEditorStore((s) => s.setActiveFile)
  const createNewFile = useEditorStore((s) => s.createNewFile)
  const openFile = useEditorStore((s) => s.openFile)

  const [showNewModal, setShowNewModal] = useState(false)

  const handleOpenLocalFile = async () => {
    const res = await platform.openLocalFile()
    if (res.success && res.name && res.content !== undefined) {
      openFile(res.name, res.name, res.content)
    }
  }

  const handleOpenLocalFolder = async () => {
    const res = await platform.openLocalFolder()
    if (res.success && res.files) {
      for (const f of res.files) {
        openFile(f.name, f.name, f.content)
      }
    }
  }

  return (
    <div className="app-sidebar no-select" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="sidebar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px' }}>
        <span style={{ fontWeight: 600, fontSize: '12px' }}>Workspace Files</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            className="toolbar-btn"
            onClick={() => setShowNewModal(true)}
            title="New File"
            style={{ height: '24px', minWidth: '24px', padding: '0 4px', fontSize: '13px' }}
          >
            +
          </button>
          <button
            className="toolbar-btn"
            onClick={handleOpenLocalFile}
            title="Open Local File"
            style={{ height: '24px', minWidth: '24px', padding: '0 4px', fontSize: '12px' }}
          >
            📄
          </button>
          <button
            className="toolbar-btn"
            onClick={handleOpenLocalFolder}
            title="Upload Folder"
            style={{ height: '24px', minWidth: '24px', padding: '0 4px', fontSize: '12px' }}
          >
            📂
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {openFiles.map((file) => {
          const isSelected = file.id === activeFileId
          return (
            <div
              key={file.id}
              className={`tree-item ${isSelected ? 'selected' : ''}`}
              onClick={() => setActiveFile(file.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: '13px',
                background: isSelected ? 'var(--bg-elevated)' : 'transparent',
                color: isSelected ? 'var(--accent-blue)' : 'var(--text-primary)'
              }}
            >
              <span>{getFileIcon(file.name)}</span>
              <span className="truncate" style={{ flex: 1 }}>{file.name}</span>
              {file.isDirty && (
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-orange)' }} />
              )}
            </div>
          )
        })}
      </div>

      {showNewModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={() => setShowNewModal(false)}
        >
          <div
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-primary)',
              borderRadius: '8px',
              padding: '16px',
              width: '260px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>Create New File</h4>
            {(['python', 'cpp', 'c'] as LanguageId[]).map((lang) => (
              <button
                key={lang}
                onClick={() => {
                  createNewFile(lang)
                  setShowNewModal(false)
                }}
                style={{
                  padding: '8px 12px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-secondary)',
                  color: 'var(--text-primary)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <span>{lang === 'python' ? '🟢' : lang === 'cpp' ? '🟣' : '🔵'}</span>
                <span>{lang === 'python' ? 'Python File (.py)' : lang === 'cpp' ? 'C++ File (.cpp)' : 'C File (.c)'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
