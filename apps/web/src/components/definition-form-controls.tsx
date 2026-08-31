'use client'

import type { ApiOperationReference, JsonSchemaReference, ProjectFile } from '@system-design/model'
import type { ProjectEditIssue } from '@/lib/store'
import { localizedValue, useI18n } from '@/lib/i18n'

export const issueAt = (issues: ProjectEditIssue[], path: Array<string | number>) => issues.find((issue) => path.every((part, index) => issue.path[index] === part))?.message

export function TextInput({ label, value, onChange, issues = [], path = [], placeholder }: { label: string; value: string; onChange: (value: string) => void; issues?: ProjectEditIssue[]; path?: Array<string | number>; placeholder?: string }) {
  const { t } = useI18n()
  const issue = issueAt(issues, path)
  return <label className={`definition-field${issue ? ' has-error' : ''}`}><span>{t(label)}</span><input value={value} placeholder={placeholder ? t(placeholder) : undefined} aria-invalid={Boolean(issue)} onChange={(event) => onChange(event.target.value)} />{issue ? <small>{t(issue)}</small> : null}</label>
}

export function NumberInput({ label, value, onChange, issues = [], path = [], min, max, step = 1, optional = false }: { label: string; value: number | undefined; onChange: (value: number | undefined) => void; issues?: ProjectEditIssue[]; path?: Array<string | number>; min?: number; max?: number; step?: number; optional?: boolean }) {
  const { t } = useI18n()
  const issue = issueAt(issues, path)
  return <label className={`definition-field${issue ? ' has-error' : ''}`}><span>{t(label)}</span><input type="number" value={value ?? ''} step={step} {...(min === undefined ? {} : { min })} {...(max === undefined ? {} : { max })} aria-invalid={Boolean(issue)} onChange={(event) => {
    if (event.target.value === '' && optional) onChange(undefined)
    else if (Number.isFinite(event.target.valueAsNumber)) onChange(event.target.valueAsNumber)
  }} />{issue ? <small>{t(issue)}</small> : null}</label>
}

export function SelectInput<T extends string>({ label, value, options, onChange, issues = [], path = [], disabled = false }: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange: (value: T) => void; issues?: ProjectEditIssue[]; path?: Array<string | number>; disabled?: boolean }) {
  const { t } = useI18n()
  const issue = issueAt(issues, path)
  return <label className={`definition-field${issue ? ' has-error' : ''}`}><span>{t(label)}</span><select value={value} disabled={disabled} aria-invalid={Boolean(issue)} onChange={(event) => onChange(event.target.value as T)}>{options.map((option) => <option value={option.value} key={option.value}>{localizedValue(t, option.value, t(option.label))}</option>)}</select>{issue ? <small>{t(issue)}</small> : null}</label>
}

export function CheckInput({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const { t } = useI18n()
  return <label className="definition-check"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{t(label)}</span></label>
}

export function IdentityFields<T extends { id: string; name: string; version?: number }>({ value, issues, onChange }: { value: T; issues: ProjectEditIssue[]; onChange: (value: T) => void }) {
  return <div className="definition-field-grid">
    <TextInput label="Stable ID" value={value.id} issues={issues} path={['id']} onChange={(id) => onChange({ ...value, id })} />
    <TextInput label="Display name" value={value.name} issues={issues} path={['name']} onChange={(name) => onChange({ ...value, name })} />
    {'version' in value ? <NumberInput label="Version" value={value.version} min={1} issues={issues} path={['version']} onChange={(version) => { if (version !== undefined) onChange({ ...value, version }) }} /> : null}
  </div>
}

export function NodeSelect({ project, label, value, onChange, type, issues = [], path = [] }: { project: ProjectFile; label: string; value: string; onChange: (value: string) => void; type?: ProjectFile['topology']['nodes'][number]['type'] | Array<ProjectFile['topology']['nodes'][number]['type']>; issues?: ProjectEditIssue[]; path?: Array<string | number> }) {
  const accepted = type === undefined ? undefined : new Set(Array.isArray(type) ? type : [type])
  const nodes = project.topology.nodes.filter((node) => !accepted || accepted.has(node.type))
  const options = nodes.map((node) => ({ value: node.id, label: `${node.name} · ${node.type}` }))
  if (!options.some((option) => option.value === value)) options.unshift({ value, label: `${value} · unresolved` })
  return <SelectInput label={label} value={value} options={options} onChange={onChange} issues={issues} path={path} />
}

const schemaKey = (reference: JsonSchemaReference) => `${reference.schemaId}@${reference.schemaVersion}`
export function SchemaReferenceSelect({ project, label, value, onChange, issues = [], path = [] }: { project: ProjectFile; label: string; value: JsonSchemaReference; onChange: (value: JsonSchemaReference) => void; issues?: ProjectEditIssue[]; path?: Array<string | number> }) {
  const options = project.definitions.jsonSchemas.map((schema) => ({ value: `${schema.id}@${schema.version}`, label: `${schema.name} · ${schema.id}@${schema.version}` }))
  const current = schemaKey(value)
  if (!options.some((option) => option.value === current)) options.unshift({ value: current, label: `${current} · unresolved` })
  return <SelectInput label={label} value={current} options={options} issues={issues} path={path} onChange={(key) => {
    const divider = key.lastIndexOf('@'); onChange({ schemaId: key.slice(0, divider), schemaVersion: Number(key.slice(divider + 1)) })
  }} />
}

export const operationKey = (reference: ApiOperationReference) => `${reference.apiId}@${reference.apiVersion}:${reference.operationId}`
export function OperationReferenceSelect({ project, label, value, onChange, issues = [], path = [] }: { project: ProjectFile; label: string; value: ApiOperationReference; onChange: (value: ApiOperationReference) => void; issues?: ProjectEditIssue[]; path?: Array<string | number> }) {
  const options = project.definitions.apis.flatMap((api) => api.operations.map((operation) => ({ value: `${api.id}@${api.version}:${operation.id}`, label: `${operation.name} · ${operation.method} ${operation.path}` })))
  const current = operationKey(value)
  if (!options.some((option) => option.value === current)) options.unshift({ value: current, label: `${current} · unresolved` })
  return <SelectInput label={label} value={current} options={options} issues={issues} path={path} onChange={(key) => {
    const divider = key.lastIndexOf(':'); const versionDivider = key.lastIndexOf('@', divider)
    onChange({ apiId: key.slice(0, versionDivider), apiVersion: Number(key.slice(versionDivider + 1, divider)), operationId: key.slice(divider + 1) })
  }} />
}

export function StringListInput({ label, value, onChange, issues = [], path = [], placeholder }: { label: string; value: string[]; onChange: (value: string[]) => void; issues?: ProjectEditIssue[]; path?: Array<string | number>; placeholder?: string }) {
  const { t } = useI18n()
  const issue = issueAt(issues, path)
  return <label className={`definition-field${issue ? ' has-error' : ''}`}><span>{t(label)}</span><input value={value.join(', ')} placeholder={placeholder ? t(placeholder) : undefined} aria-invalid={Boolean(issue)} onChange={(event) => onChange(event.target.value.split(',').map((entry) => entry.trim()).filter(Boolean))} />{issue ? <small>{t(issue)}</small> : null}</label>
}

export function IdListSelect({ label, value, options, onChange, issues = [], path = [] }: { label: string; value: string[]; options: ReadonlyArray<{ value: string; label: string }>; onChange: (value: string[]) => void; issues?: ProjectEditIssue[]; path?: Array<string | number> }) {
  const { t } = useI18n()
  const issue = issueAt(issues, path)
  return <fieldset className={`definition-check-list${issue ? ' has-error' : ''}`}><legend>{t(label)}</legend>{options.map((option) => <CheckInput key={option.value} label={option.label} checked={value.includes(option.value)} onChange={(checked) => onChange(checked ? [...value, option.value] : value.filter((entry) => entry !== option.value))} />)}{issue ? <small>{t(issue)}</small> : null}</fieldset>
}
