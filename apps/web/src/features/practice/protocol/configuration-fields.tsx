export type ConfigurationField<C> = { [K in keyof C]: { key: K; label: string; ariaLabel?: string; choices: readonly { value: C[K]; label: string }[]; locked?: boolean } }[keyof C]

/** Shared typed choice controls; configuration parsing stays in each model. */
export function ConfigurationFields<C extends object>({ config, fields, change, disabled }: { config: C; fields: readonly ConfigurationField<C>[]; change: (value: C) => void; disabled: boolean }) {
  return <>{fields.map(field => <label key={String(field.key)}>{field.label}<select aria-label={field.ariaLabel ?? field.label} value={String(config[field.key])} disabled={disabled || field.locked} onChange={event => {
    const choice = field.choices.find(item => String(item.value) === event.target.value)
    if (choice) change({ ...config, [field.key]: choice.value })
  }}>{field.choices.map(choice => <option key={String(choice.value)} value={String(choice.value)}>{choice.label}</option>)}</select></label>)}</>
}
