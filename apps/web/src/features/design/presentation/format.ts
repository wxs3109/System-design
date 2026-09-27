import type { EvidenceValue, SemanticMessage } from '../../../core/experiments/evidence'
export type MessageFormatters = Readonly<Record<string, (values: readonly EvidenceValue[]) => string>>
export function messageFormatter(formatters: MessageFormatters) {
  const text = (value: EvidenceValue | undefined): string => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && typeof value.code === 'string' && Array.isArray(value.values)) return format(value as unknown as SemanticMessage)
    return String(value ?? '')
  }
  const list = (value: EvidenceValue | undefined, separator: string) => Array.isArray(value) ? value.map(text).join(separator) : ''
  const format = (message: SemanticMessage): string => {
    const formatter = formatters[message.code]
    if (!formatter) return message.code
    return formatter(message.values)
  }
  return { text, list, format }
}
