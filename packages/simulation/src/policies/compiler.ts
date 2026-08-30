import type {
  BackpressurePolicyConfig,
  CircuitBreakerPolicyConfig,
  PolicyAttachment,
  RetryPolicyConfig,
  TimeoutPolicyConfig,
  TokenBucketPolicyConfig,
} from '@system-design/model'
import { policyRegistry } from '@system-design/components'

export type CompiledPolicy =
  | { id: string; type: 'timeout'; order: number; config: TimeoutPolicyConfig }
  | { id: string; type: 'retry'; order: number; config: RetryPolicyConfig }
  | { id: string; type: 'circuit-breaker'; order: number; config: CircuitBreakerPolicyConfig }
  | { id: string; type: 'rate-limit'; order: number; config: TokenBucketPolicyConfig }
  | { id: string; type: 'backpressure'; order: number; config: BackpressurePolicyConfig }

export const compilePolicies = (attachments: readonly PolicyAttachment[]): Map<string, CompiledPolicy[]> => {
  const policies = new Map<string, CompiledPolicy[]>()
  for (const attachment of policyRegistry.validateOrder(attachments.filter((candidate) => candidate.enabled))) {
    const config = policyRegistry.validateAttachment(attachment).config
    const targetKey = `${attachment.target.kind}:${attachment.target.id}`
    const targetPolicies = policies.get(targetKey) ?? []
    targetPolicies.push({ id: attachment.id, type: attachment.type, order: attachment.order, config } as CompiledPolicy)
    policies.set(targetKey, targetPolicies)
  }
  return policies
}

export const policiesFor = <TType extends CompiledPolicy['type']>(
  policies: ReadonlyMap<string, readonly CompiledPolicy[]>,
  kind: PolicyAttachment['target']['kind'],
  targetId: string,
  type: TType,
): Extract<CompiledPolicy, { type: TType }>[] => (policies.get(`${kind}:${targetId}`) ?? []).filter((policy): policy is Extract<CompiledPolicy, { type: TType }> => policy.type === type)
