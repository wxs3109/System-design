'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { ApiDefinition, DataModel, JsonSchemaDocument, ProjectFile } from '@system-design/model'
import { Download, Upload, X } from 'lucide-react'
import { useWorkbenchStore } from '@/lib/store'
import type { DefinitionSelection } from './definition-editor-model'
import { useI18n } from '@/lib/i18n'

type FormatKind = 'openapi' | 'dbml'
const downloadText = (text: string, name: string, type: string) => {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([text], { type }))
  link.download = name
  link.click()
  URL.revokeObjectURL(link.href)
}
const responseBody = async (response: Response) => {
  if (response.ok) return response
  const payload = await response.json() as { error?: string }
  throw new Error(payload.error ?? 'Format conversion failed.')
}

export function FormatDialog({ kind, selection, onClose, onSelectionChange }: { kind: FormatKind; selection: DefinitionSelection | null; onClose: () => void; onSelectionChange: (selection: DefinitionSelection) => void }) {
  const { t } = useI18n()
  const project = useWorkbenchStore((state) => state.project)
  const commitProjectEdit = useWorkbenchStore((state) => state.commitProjectEdit)
  const [mode, setMode] = useState<'import' | 'export'>('import')
  const [source, setSource] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const serviceId = project.topology.nodes.find((node) => node.type === 'service')?.id ?? ''
  const databaseId = project.topology.nodes.find((node) => node.type === 'database')?.id ?? ''
  const selectedApi = selection?.kind === 'apis' ? project.definitions.apis.find((api) => api.id === selection.id && api.version === selection.version) : project.definitions.apis[0]
  const selectedModel = selection?.kind === 'dataModels' ? project.definitions.dataModels.find((model) => model.id === selection.id && model.version === selection.version) : project.definitions.dataModels.find((model) => model.kind === 'relational')
  const dialogTitle = t(kind === 'openapi' ? 'OpenAPI 3.1 adapter' : 'DBML adapter')

  useEffect(() => {
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab') return
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])]
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable.at(-1)!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); previouslyFocused.current?.focus() }
  }, [onClose])

  const convert = async () => {
    setBusy(true); setError(null)
    try {
      if (kind === 'openapi' && mode === 'export') {
        if (!selectedApi) throw new Error(t('Select or create an API before exporting OpenAPI.'))
        const response = await responseBody(await fetch('/api/formats/openapi', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'export', contracts: { api: selectedApi, schemas: project.definitions.jsonSchemas } }) }))
        downloadText(await response.text(), selectedApi.id + '.openapi.json', 'application/vnd.oai.openapi+json')
        return
      }
      if (kind === 'dbml' && mode === 'export') {
        if (!selectedModel || selectedModel.kind !== 'relational') throw new Error(t('Select a relational data model before exporting DBML.'))
        const response = await responseBody(await fetch('/api/formats/dbml', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'export', model: selectedModel }) }))
        downloadText(await response.text(), selectedModel.id + '.dbml', 'text/plain')
        return
      }
      if (!source.trim()) throw new Error(t('Paste a document to import.'))
      const endpoint = kind === 'openapi' ? '/api/formats/openapi' : '/api/formats/dbml'
      const request = kind === 'openapi'
        ? { action: 'import', source, apiId: 'imported-api', ownerNodeId: serviceId }
        : { action: 'import', source, options: { modelId: 'imported-relational-model', modelName: 'Imported relational model', ownerNodeId: databaseId } }
      if (kind === 'openapi' && !serviceId) throw new Error(t('Add a Service component before importing OpenAPI.'))
      if (kind === 'dbml' && !databaseId) throw new Error(t('Add a Database component before importing DBML.'))
      const response = await responseBody(await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }))
      const imported = await response.json() as { api?: ApiDefinition; schemas?: JsonSchemaDocument[] } | DataModel
      let candidate: ProjectFile
      let nextSelection: DefinitionSelection
      if (kind === 'openapi' && 'api' in imported && imported.api) {
        const api = imported.api
        candidate = { ...project, modelingMode: 'business-aware', definitions: { ...project.definitions, jsonSchemas: [...project.definitions.jsonSchemas, ...(imported.schemas ?? [])], apis: [...project.definitions.apis, api] } }
        nextSelection = { kind: 'apis', id: api.id, version: api.version }
      } else {
        const model = imported as DataModel
        candidate = { ...project, modelingMode: 'business-aware', definitions: { ...project.definitions, dataModels: [...project.definitions.dataModels, model] } }
        nextSelection = { kind: 'dataModels', id: model.id, version: model.version }
      }
      const result = commitProjectEdit(candidate)
      if (!result.success) throw new Error(result.issues[0]?.message ?? t('Imported contracts conflict with the project.'))
      onSelectionChange(nextSelection)
      onClose()
    } catch (cause) { setError(cause instanceof Error ? t(cause.message) : t('Format conversion failed.')) } finally { setBusy(false) }
  }

  return <div className="format-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section ref={dialogRef} className="format-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}><header><div><strong id={titleId}>{dialogTitle}</strong><span id={descriptionId}>{t('Mature parser · validated project mapping')}</span></div><button type="button" aria-label={t('Close format dialog')} onClick={onClose}><X size={15} /></button></header><div className="format-dialog-tabs" role="tablist" aria-label={t('Adapter action')}><button type="button" role="tab" aria-selected={mode === 'import'} tabIndex={mode === 'import' ? 0 : -1} onClick={() => setMode('import')}><Upload size={13} /> {t('Import')}</button><button type="button" role="tab" aria-selected={mode === 'export'} tabIndex={mode === 'export' ? 0 : -1} onClick={() => setMode('export')}><Download size={13} /> {t('Export')}</button></div>{mode === 'import' ? <label className="definition-field definition-field--code"><span>{t('Paste {format}', { format: kind === 'openapi' ? 'OpenAPI JSON' : 'DBML' })}</span><textarea autoFocus rows={17} spellCheck={false} value={source} onChange={(event) => setSource(event.target.value)} /></label> : <p className="format-dialog-summary">{kind === 'openapi' ? selectedApi ? t('Export {name} and referenced JSON Schemas.', { name: selectedApi.name }) : t('No API is available.') : selectedModel?.kind === 'relational' ? t('Export {name}.', { name: selectedModel.name }) : t('No relational model is selected.')}</p>}{error ? <p className="format-dialog-error" role="alert">{error}</p> : null}<footer><button type="button" className="button subtle" onClick={onClose}>{t('Cancel')}</button><button type="button" className="button run" disabled={busy} onClick={() => void convert()}>{t(busy ? 'Converting…' : mode === 'import' ? 'Validate and import' : 'Export file')}</button></footer></section></div>
}
