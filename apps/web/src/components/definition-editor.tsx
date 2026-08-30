'use client'

import { useMemo, useState } from 'react'
import { Braces, ChevronDown, Database, FileJson, Gauge, GitBranch, Plus, Radio, Server, Trash2 } from 'lucide-react'
import type {
  ApiDefinition, CacheKeyDefinition, DataModel, EventDefinition, InteractionDefinition, JsonSchemaDocument, OperationWorkload, ProjectFile,
} from '@system-design/model'
import { useWorkbenchStore, type ProjectEditIssue } from '@/lib/store'
import {
  addDefinitionResource, createDefinitionResource, definitionGroups, findDefinitionResource, listDefinitionResources, removeDefinitionResource,
  replaceDefinitionResource, selectionKey, type DataModelKind, type DefinitionKind, type DefinitionResource, type DefinitionSelection,
} from './definition-editor-model'
import { ApiEditor, CacheKeyEditor, EventEditor, JsonSchemaEditor, OperationWorkloadEditor } from './definition-resource-editors'
import { DataModelEditor } from './data-model-editor'
import { InteractionEditor } from './interaction-editor'

const groupIcons: Record<DefinitionKind, typeof Braces> = {
  jsonSchemas: FileJson, apis: Server, dataModels: Database, events: Radio, cacheKeys: Braces, interactions: GitBranch, operationWorkloads: Gauge,
}

const nextSelectionAfterDelete = (project: ProjectFile, removed: DefinitionSelection): DefinitionSelection | null => {
  const groupIndex = definitionGroups.findIndex((group) => group.kind === removed.kind)
  const sameGroup = listDefinitionResources(project, removed.kind).filter((item) => selectionKey(item) !== selectionKey(removed))
  if (sameGroup[0]) return sameGroup[0]
  for (let offset = 1; offset < definitionGroups.length; offset += 1) {
    const group = definitionGroups[(groupIndex + offset) % definitionGroups.length]
    if (!group) continue
    const item = listDefinitionResources(project, group.kind)[0]
    if (item) return item
  }
  return null
}

const focusSibling = (event: React.KeyboardEvent<HTMLButtonElement>, direction: -1 | 1) => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  const buttons = [...(event.currentTarget.closest('.definitions-explorer')?.querySelectorAll<HTMLButtonElement>('.definition-item') ?? [])]
  const index = buttons.indexOf(event.currentTarget)
  buttons[(index + direction + buttons.length) % buttons.length]?.focus()
}

export function DefinitionsExplorer({ project, selection, onSelect, onError }: {
  project: ProjectFile
  selection: DefinitionSelection | null
  onSelect: (selection: DefinitionSelection) => void
  onError: (message: string) => void
}) {
  const commitProjectEdit = useWorkbenchStore((state) => state.commitProjectEdit)
  const add = (kind: DefinitionKind, modelKind?: DataModelKind) => {
    try {
      const resource = createDefinitionResource(project, kind, modelKind)
      const candidate = addDefinitionResource(project, kind, resource)
      const result = commitProjectEdit(candidate)
      if (!result.success) throw new Error(result.issues[0]?.message ?? 'The definition could not be added.')
      onSelect({ kind, id: resource.id, ...('version' in resource ? { version: resource.version } : {}) })
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'The definition could not be added.')
    }
  }

  return (
    <nav className="definitions-explorer" aria-label="Project definitions">
      <div className="definitions-explorer__heading"><div><strong>Definitions</strong><span>Business contracts</span></div></div>
      <div className="definition-groups">
        {definitionGroups.map((group) => {
          const Icon = groupIcons[group.kind]
          const items = listDefinitionResources(project, group.kind)
          return <section className="definition-group" key={group.kind} aria-labelledby={`definition-group-${group.kind}`}>
            <div className="definition-group__heading"><span id={`definition-group-${group.kind}`}><Icon size={13} aria-hidden="true" />{group.label}<small>{items.length}</small></span>
              {group.kind === 'dataModels' ? <div className="definition-add-menu">
                <button type="button" aria-label="Add data model"><Plus size={12} /><ChevronDown size={10} /></button>
                <div><button type="button" onClick={() => add('dataModels', 'relational')}>Relational</button><button type="button" onClick={() => add('dataModels', 'document')}>Document</button><button type="button" onClick={() => add('dataModels', 'key-value')}>Key-value</button></div>
              </div> : <button type="button" className="definition-add" aria-label={`Add ${group.label}`} onClick={() => add(group.kind)}><Plus size={12} /></button>}
            </div>
            <div className="definition-group__items">
              {items.map((item) => <button type="button" className="definition-item" key={selectionKey(item)} aria-current={selection && selectionKey(selection) === selectionKey(item) ? 'true' : undefined}
                onKeyDown={(event) => focusSibling(event, event.key === 'ArrowUp' ? -1 : 1)} onClick={() => onSelect(item)}>
                <span>{item.name}</span><small>{item.id}{item.version === undefined ? '' : ` · v${item.version}`}</small><em>{item.detail}</em>
              </button>)}
              {items.length === 0 ? <p>{group.emptyLabel}</p> : null}
            </div>
          </section>
        })}
      </div>
    </nav>
  )
}

const relativeIssues = (project: ProjectFile, selection: DefinitionSelection, issues: ProjectEditIssue[]): ProjectEditIssue[] => {
  if (selection.kind === 'operationWorkloads') {
    const experimentIndex = project.experiments.findIndex((experiment) => experiment.id === project.activeExperimentId)
    const resourceIndex = project.experiments[experimentIndex]?.operationWorkloads.findIndex((resource) => resource.id === selection.id) ?? -1
    const prefix = ['experiments', experimentIndex, 'operationWorkloads', resourceIndex]
    return issues.map((issue) => issue.path.slice(0, prefix.length).every((part, index) => part === prefix[index]) ? { ...issue, path: issue.path.slice(prefix.length) } : issue)
  }
  const resourceIndex = project.definitions[selection.kind].findIndex((resource) => resource.id === selection.id && resource.version === selection.version)
  const prefix: Array<string | number> = ['definitions', selection.kind, resourceIndex]
  return issues.map((issue) => {
    if (issue.path.slice(0, prefix.length).every((part, index) => part === prefix[index])) return { ...issue, path: issue.path.slice(prefix.length) }
    return { ...issue, path: ['dependency', ...issue.path] }
  })
}

export function DefinitionEditor({ selection, onSelectionChange }: {
  selection: DefinitionSelection | null
  onSelectionChange: (selection: DefinitionSelection | null) => void
}) {
  const project = useWorkbenchStore((state) => state.project)
  const commitProjectEdit = useWorkbenchStore((state) => state.commitProjectEdit)
  const resource = selection ? findDefinitionResource(project, selection) : undefined
  const currentKey = selection ? selectionKey(selection) : ''
  const [draftState, setDraftState] = useState<{ key: string; resourceFingerprint: string; draft: DefinitionResource | null; issues: ProjectEditIssue[] }>(() => ({
    key: currentKey, resourceFingerprint: resource ? JSON.stringify(resource) : '', draft: resource ? structuredClone(resource) : null, issues: [],
  }))
  const currentFingerprint = resource ? JSON.stringify(resource) : ''
  const synchronized = draftState.key === currentKey && (draftState.issues.length > 0 || draftState.resourceFingerprint === currentFingerprint)
    ? draftState
    : { key: currentKey, resourceFingerprint: currentFingerprint, draft: resource ? structuredClone(resource) : null, issues: [] }
  const draft = synchronized.draft
  const issues = synchronized.issues
  const updateDraft = (next: DefinitionResource | null, nextIssues: ProjectEditIssue[], resourceFingerprint = synchronized.resourceFingerprint) => setDraftState({ key: currentKey, resourceFingerprint, draft: next, issues: nextIssues })

  const commit = (next: DefinitionResource, extraIssues: ProjectEditIssue[] = []) => {
    if (!selection || extraIssues.length > 0) { updateDraft(next, extraIssues); return }
    const latest = useWorkbenchStore.getState().project
    const result = commitProjectEdit(replaceDefinitionResource(latest, selection, next))
    if (!result.success) { updateDraft(next, relativeIssues(latest, selection, result.issues)); return }
    updateDraft(next, [], JSON.stringify(next))
    const nextSelection = { kind: selection.kind, id: next.id, ...('version' in next ? { version: next.version } : {}) }
    if (selectionKey(nextSelection) !== selectionKey(selection)) onSelectionChange(nextSelection)
  }

  const remove = () => {
    if (!selection) return
    const latest = useWorkbenchStore.getState().project
    const result = commitProjectEdit(removeDefinitionResource(latest, selection))
    if (!result.success) { if (draft) updateDraft(draft, relativeIssues(latest, selection, result.issues)); return }
    onSelectionChange(nextSelectionAfterDelete(latest, selection))
  }

  if (!selection || !draft) return <div className="definition-editor-empty"><GitBranch size={26} /><strong>Select or create a definition</strong><p>Contracts, data shape, access paths, and operation traffic live in the exported ProjectFile.</p></div>

  return <div className="definition-editor" aria-label="Definition editor">
    <header className="definition-editor__header"><div><span>{definitionGroups.find((group) => group.kind === selection.kind)?.label}</span><strong>{draft.name}</strong><code>{draft.id}{'version' in draft ? `@${draft.version}` : ''}</code></div>
      <button type="button" className="icon-button danger" aria-label={`Delete ${draft.name}`} onClick={remove}><Trash2 size={15} /></button>
    </header>
    {issues.length > 0 ? <div className="definition-errors" role="alert"><strong>{issues.length} issue{issues.length === 1 ? '' : 's'} must be resolved</strong><ul>{issues.slice(0, 8).map((issue, index) => <li key={`${issue.path.join('.')}-${index}`}><code>{issue.path[0] === 'dependency' ? 'Referenced by ' + issue.path.slice(1).join('.') : issue.path.join('.') || 'definition'}</code> {issue.message}</li>)}</ul></div> : <div className="definition-valid" role="status">Saved to project · undo available</div>}
    <div className="definition-editor__body">
      {selection.kind === 'jsonSchemas' ? <JsonSchemaEditor value={draft as JsonSchemaDocument} issues={issues} onChange={commit} /> : null}
      {selection.kind === 'apis' ? <ApiEditor project={project} value={draft as ApiDefinition} issues={issues} onChange={commit} /> : null}
      {selection.kind === 'dataModels' ? <DataModelEditor project={project} value={draft as DataModel} issues={issues} onChange={commit} /> : null}
      {selection.kind === 'events' ? <EventEditor project={project} value={draft as EventDefinition} issues={issues} onChange={commit} /> : null}
      {selection.kind === 'cacheKeys' ? <CacheKeyEditor project={project} value={draft as CacheKeyDefinition} issues={issues} onChange={commit} /> : null}
      {selection.kind === 'interactions' ? <InteractionEditor project={project} value={draft as InteractionDefinition} issues={issues} onChange={commit} /> : null}
      {selection.kind === 'operationWorkloads' ? <OperationWorkloadEditor project={project} value={draft as OperationWorkload} issues={issues} onChange={commit} /> : null}
    </div>
  </div>
}

export const useSelectedDefinitionBindings = (selection: DefinitionSelection | null) => {
  const project = useWorkbenchStore((state) => state.project)
  return useMemo(() => {
    if (!selection) return { resource: undefined, nodeIds: new Set<string>() }
    const selected = findDefinitionResource(project, selection)
    if (!selected) return { resource: undefined, nodeIds: new Set<string>() }
    const nodeIds = new Set<string>()
    if ('ownerNodeId' in selected) nodeIds.add(selected.ownerNodeId)
    if ('producerNodeId' in selected) { nodeIds.add(selected.producerNodeId); selected.consumerNodeIds.forEach((id) => nodeIds.add(id)) }
    if ('sourceNodeId' in selected && !('actions' in selected)) nodeIds.add(selected.sourceNodeId)
    if ('actions' in selected) selected.actions.forEach((action) => {
      if ('sourceNodeId' in action) nodeIds.add(action.sourceNodeId)
      if ('targetNodeId' in action) nodeIds.add(action.targetNodeId)
      if ('nodeId' in action) nodeIds.add(action.nodeId)
      if ('producerNodeId' in action) nodeIds.add(action.producerNodeId)
      if ('consumerNodeId' in action) nodeIds.add(action.consumerNodeId)
      if ('brokerNodeId' in action) nodeIds.add(action.brokerNodeId)
    })
    return { resource: selected, nodeIds }
  }, [project, selection])
}
