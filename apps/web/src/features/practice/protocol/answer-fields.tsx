import styles from '../retry-idempotency/retry-lab.module.css'
export interface AnswerField { id: string; label: string; options?: readonly { value: string; label: string }[] }
export function AnswerFields({ fields, answers, change, disabled }: { fields: readonly AnswerField[]; answers: Record<string, string>; change: (answers: Record<string, string>) => void; disabled: boolean }) {
  return <div className={styles.answers}>{fields.map((field) => <label key={field.id}>{field.label}{field.options ? <select aria-label={field.label} value={answers[field.id] ?? ''} disabled={disabled} onChange={(e) => change({ ...answers, [field.id]: e.target.value })}><option value="">选择结论</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input aria-label={field.label} value={answers[field.id] ?? ''} maxLength={100} disabled={disabled} onChange={(e) => change({ ...answers, [field.id]: e.target.value })} />}</label>)}</div>
}
