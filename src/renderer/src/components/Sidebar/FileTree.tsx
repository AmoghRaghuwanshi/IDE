import { useState, useEffect, useCallback } from 'react'
import { useEditorStore } from '../../state/editorStore'

interface TreeNode {
  name: string
  path: string
  isDirectory: boolean
  children?: TreeNode[]
  expanded?: boolean
}

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
    case 'txt':
    case 'md':
      return '📄'
    case 'json':
      return '📋'
    default:
      return '📄'
  }
}

function isSourceFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase()
  return ['c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'hxx', 'py', 'txt', 'md', 'json'].includes(
    ext || ''
  )
}

function TreeItem({
  node,
  depth,
  onFileClick,
  onToggle
}: {
  node: TreeNode
  depth: number
  onFileClick: (path: string, name: string) => void
  onToggle: (path: string) => void
}) {
  const activeFileId = useEditorStore((s) => s.activeFileId)
  const openFiles = useEditorStore((s) => s.openFiles)
  const isSelected = openFiles.some((f) => f.path === node.path && f.id === activeFileId)

  return (
    <>
      <div
        className={`tree-item ${isSelected ? 'selected' : ''}`}
        style={{ '--tree-depth': depth } as React.CSSProperties}
        onClick={() => {
          if (node.isDirectory) {
            onToggle(node.path)
          } else {
            onFileClick(node.path, node.name)
          }
        }}
      >
        {node.isDirectory ? (
          <span className={`tree-chevron ${node.expanded ? 'expanded' : ''}`}>▶</span>
        ) : (
          <span className="tree-item-icon">{getFileIcon(node.name)}</span>
        )}
        <span className="truncate">{node.name}</span>
      </div>
      {node.isDirectory && node.expanded && node.children && (
        <>
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              onFileClick={onFileClick}
              onToggle={onToggle}
            />
          ))}
        </>
      )}
    </>
  )
}

export default function FileTree() {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const workingDirectory = useEditorStore((s) => s.workingDirectory)
  const setWorkingDirectory = useEditorStore((s) => s.setWorkingDirectory)
  const openFile = useEditorStore((s) => s.openFile)

  const loadDirectory = useCallback(
    async (dirPath: string): Promise<TreeNode[]> => {
      const result = await window.api.listDir(dirPath)
      if (!result.success) return []

      return result.nodes.map((node) => ({
        name: node.name,
        path: node.path,
        isDirectory: node.isDirectory,
        expanded: false,
        children: node.isDirectory ? [] : undefined
      }))
    },
    []
  )

  useEffect(() => {
    if (workingDirectory) {
      loadDirectory(workingDirectory).then(setTree)
    }
  }, [workingDirectory, loadDirectory])

  const handleOpenFolder = async (): Promise<void> => {
    const result = await window.api.selectDirectory()
    if (result.success && result.path) {
      setWorkingDirectory(result.path)
    }
  }

  const handleFileClick = async (path: string, name: string): Promise<void> => {
    if (!isSourceFile(name)) return
    const result = await window.api.readFile(path)
    if (result.success && result.content !== undefined) {
      openFile(path, name, result.content)
    }
  }

  const handleToggle = async (path: string): Promise<void> => {
    const toggle = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
      const result: TreeNode[] = []
      for (const node of nodes) {
        if (node.path === path) {
          if (!node.expanded) {
            const children = await loadDirectory(path)
            result.push({ ...node, expanded: true, children })
          } else {
            result.push({ ...node, expanded: false })
          }
        } else if (node.children) {
          const updatedChildren = await toggle(node.children)
          result.push({ ...node, children: updatedChildren })
        } else {
          result.push(node)
        }
      }
      return result
    }
    setTree(await toggle(tree))
  }

  const handleCreateFile = async (): Promise<void> => {
    if (!workingDirectory || !newFileName.trim()) return
    const name = newFileName.trim()
    const result = await window.api.createFile(workingDirectory, name, '')
    if (result.success && result.path) {
      // Refresh tree and open the new file
      const newTree = await loadDirectory(workingDirectory)
      setTree(newTree)
      openFile(result.path, name, '')
    }
    setNewFileName('')
    setIsCreating(false)
  }

  return (
    <div className="app-sidebar no-select">
      <div className="sidebar-header">
        <span>Explorer</span>
        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
          {workingDirectory && (
            <button
              className="toolbar-btn"
              onClick={() => setIsCreating(true)}
              title="New File"
              style={{ height: '24px', fontSize: 'var(--font-size-xs)', minWidth: '24px', padding: '0 4px' }}
            >
              +
            </button>
          )}
          <button
            className="toolbar-btn"
            onClick={handleOpenFolder}
            title="Open Folder"
            style={{ height: '24px', fontSize: 'var(--font-size-xs)' }}
          >
            📂
          </button>
        </div>
      </div>
      <div className="sidebar-content">
        {isCreating && (
          <div style={{ padding: 'var(--space-1) var(--space-3)', display: 'flex', gap: 'var(--space-1)' }}>
            <input
              autoFocus
              type="text"
              placeholder="filename.py"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFile()
                if (e.key === 'Escape') { setIsCreating(false); setNewFileName('') }
              }}
              onBlur={() => { setIsCreating(false); setNewFileName('') }}
              style={{
                flex: 1,
                background: 'var(--bg-primary)',
                border: '1px solid var(--accent-blue)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: 'var(--font-size-sm)',
                padding: '2px 6px',
                outline: 'none',
                fontFamily: 'var(--font-mono)'
              }}
            />
          </div>
        )}
        {tree.length === 0 && !isCreating ? (
          <div
            style={{
              padding: 'var(--space-4)',
              textAlign: 'center',
              color: 'var(--text-tertiary)',
              fontSize: 'var(--font-size-sm)'
            }}
          >
            <p style={{ marginBottom: 'var(--space-3)' }}>No folder open</p>
            <button className="toolbar-btn" onClick={handleOpenFolder}>
              Open Folder
            </button>
          </div>
        ) : (
          tree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              depth={0}
              onFileClick={handleFileClick}
              onToggle={handleToggle}
            />
          ))
        )}
      </div>
    </div>
  )
}
