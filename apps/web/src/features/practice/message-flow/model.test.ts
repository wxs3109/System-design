import { describe, expect, it } from 'vitest'
import { contiguousCheckpoint, defaultConfig, runModel, unsettled, type Command, type ConsumerMode } from './model'
import { productionCommands, scenarioCommands } from './lesson'

const config = (consumer: ConsumerMode = 'atomic') => ({ ...defaultConfig(), consumer })
describe('broker, worker and checkpoint transitions', () => {
  it.each([
    ['early', 'before-effect', 0, 0], ['split', 'before-effect', 1, 1], ['atomic', 'before-effect', 1, 1],
    ['early', 'after-effect', 1, 0], ['split', 'after-effect', 2, 1], ['atomic', 'after-effect', 1, 1],
    ['early', 'lost-ack', 1, 1], ['split', 'lost-ack', 1, 1], ['atomic', 'lost-ack', 1, 1],
  ] as const)('%s / %s has effects=%i, checkpoints=%i', (consumer, scenario, effects, checkpoints) => {
    const c = config(consumer)
    const state = runModel(c, scenarioCommands(c, scenario))
    expect(state.effects).toHaveLength(effects)
    expect(state.checkpoints).toHaveLength(checkpoints)
    expect(state.copies.every((copy) => copy.status === 'acked')).toBe(true)
    expect(unsettled(state)).toBe(0)
  })
  it('redelivers from a timer without another publication and rejects old ACK receipts', () => {
    const c = config()
    const commands: Command[] = [...productionCommands(c, []), { type: 'deliver-work', deliveryId: 'delivery-1' }, { type: 'process', deliveryId: 'delivery-1' }, { type: 'advance', ms: 500 }, { type: 'deliver-ack', ackId: 'ack-1' }]
    const state = runModel(c, commands)
    expect(state.publications).toHaveLength(1)
    expect(state.deliveries).toHaveLength(2)
    expect(state.acks[0]!.status).toBe('ignored')
    expect(state.copies[0]!.activeDelivery).toBe('delivery-2')
    expect(state.copies[0]!.status).toBe('in-flight')
    expect(state.effects).toHaveLength(1)
  })
  it('expiry does not kill old work; atomic processing guards overlapping receipts', () => {
    for (const consumer of ['split', 'atomic'] as const) {
      const c = config(consumer)
      const commands: Command[] = [...productionCommands(c, []), { type: 'deliver-work', deliveryId: 'delivery-1' }, { type: 'advance', ms: 500 }, { type: 'deliver-work', deliveryId: 'delivery-2' }, { type: 'process', deliveryId: 'delivery-2' }, { type: 'process', deliveryId: 'delivery-1' }]
      const state = runModel(c, commands)
      expect(state.effects).toHaveLength(consumer === 'atomic' ? 1 : 2)
      expect(state.deliveries[0]!.location).toBe('worker')
      expect(state.deliveries[0]!.status).toBe('expired')
    }
  })
  it('does not advance the contiguous checkpoint past an unfinished earlier message', () => {
    const c = { ...config(), prefetch: 2 }
    let commands = productionCommands(c, [])
    commands = productionCommands(c, commands)
    commands.push({ type: 'deliver-work', deliveryId: 'delivery-2' }, { type: 'process', deliveryId: 'delivery-2' })
    expect(contiguousCheckpoint(runModel(c, commands))).toBe(0)
    commands.push({ type: 'deliver-work', deliveryId: 'delivery-1' }, { type: 'process', deliveryId: 'delivery-1' })
    expect(contiguousCheckpoint(runModel(c, commands))).toBe(2)
  })
  it('keeps draining queued work after the producer crashes', () => {
    const c = config()
    let commands = productionCommands(c, [])
    commands = productionCommands(c, commands)
    commands.push({ type: 'crash-producer' }, { type: 'deliver-work', deliveryId: 'delivery-1' }, { type: 'process', deliveryId: 'delivery-1' }, { type: 'deliver-ack', ackId: 'ack-1' })
    const state = runModel(c, commands)
    expect(state.producerOnline).toBe(false)
    expect(state.deliveries[1]!.messageId).toBe('event-2')
    expect(state.copies[1]!.status).toBe('in-flight')
  })
  it('quarantines exhausted work and redrives without erasing prior effects or delivery counts', () => {
    const c = config()
    const commands: Command[] = [...productionCommands(c, []), { type: 'deliver-work', deliveryId: 'delivery-1' }, { type: 'process', deliveryId: 'delivery-1' }, { type: 'drop-ack', ackId: 'ack-1' }, { type: 'advance', ms: 1500 }]
    let state = runModel(c, commands)
    expect(state.copies[0]!.status).toBe('dead-letter')
    expect(state.effects).toHaveLength(1)
    commands.push({ type: 'redrive', copyId: 'copy-1' }, { type: 'deliver-work', deliveryId: 'delivery-4' }, { type: 'process', deliveryId: 'delivery-4' }, { type: 'deliver-ack', ackId: 'ack-2' })
    state = runModel(c, commands)
    expect(state.effects).toHaveLength(1)
    expect(state.copies[0]).toMatchObject({ status: 'acked', totalAttempts: 4, attempts: 1, redrives: 1 })
    expect(state.deliveries[1]!.location).toBe('network') // Old packets did not disappear.
    expect(unsettled(state)).toBeGreaterThan(0)
  })
  it('makes pause stop new dispatch, but retains in-flight work and resumes pending work', () => {
    const c = config()
    const commands: Command[] = [{ type: 'pause-consumer' }, ...productionCommands(c, [])]
    expect(runModel(c, commands).deliveries).toHaveLength(0)
    commands.push({ type: 'start-consumer' })
    expect(runModel(c, commands).deliveries).toHaveLength(1)
  })
  it('blocks invalid checkpoint ordering and invalid publication confirmation', () => {
    const c = config('split')
    expect(() => runModel(c, [...productionCommands(c, []), { type: 'deliver-work', deliveryId: 'delivery-1' }, { type: 'checkpoint', deliveryId: 'delivery-1' }])).toThrow('Checkpoint')
    const outbox = { ...c, producer: 'outbox' as const }
    expect(() => runModel(outbox, [{ type: 'create-task' }, { type: 'relay' }, { type: 'mark-sent', publicationId: 'publication-1' }])).toThrow('确认')
    expect(() => runModel(c, Array(2))).toThrow('无效')
    expect(() => runModel({ ...c, modelVersion: 'future' } as never, [])).toThrow('未知')
    expect(() => runModel(c, [{ type: 'advance', ms: 120000 }, { type: 'advance', ms: 1 }])).toThrow('上限')
  })
})
describe('transactional Outbox boundaries', () => {
  it('survives commit-before-send by retaining a durable sending intent', () => {
    for (const producer of ['direct', 'outbox'] as const) {
      const c = { ...config(), producer }
      const state = runModel(c, scenarioCommands(c, 'commit-gap'))
      expect(state.tasks).toHaveLength(1)
      expect(state.effects).toHaveLength(producer === 'outbox' ? 1 : 0)
      expect(state.outbox).toHaveLength(producer === 'outbox' ? 1 : 0)
    }
  })
  it('re-publishes the same logical message after a crash before marking, without duplicate atomic effects', () => {
    const c = { ...config(), producer: 'outbox' as const }
    const state = runModel(c, scenarioCommands(c, 'confirm-gap'))
    expect(state.publications).toHaveLength(2)
    expect(state.copies).toHaveLength(2)
    expect(new Set(state.copies.map((copy) => copy.messageId)).size).toBe(1)
    expect(state.effects).toHaveLength(1)
    expect(state.outbox[0]!.status).toBe('sent')
  })
  it('does not make separately committed consumer effects safe across a consumer crash', () => {
    const c = { ...config('split'), producer: 'outbox' as const }
    const state = runModel(c, scenarioCommands(c, 'consumer-gap'))
    expect(state.outbox[0]!.status).toBe('sent')
    expect(state.effects).toHaveLength(2)
  })
  it('ignores old producer confirmations after a restart', () => {
    const c = { ...config(), producer: 'outbox' as const }
    const commands: Command[] = [{ type: 'create-task' }, { type: 'relay' }, { type: 'accept-publication', publicationId: 'publication-1' }, { type: 'crash-producer' }, { type: 'restart-producer' }, { type: 'deliver-confirm', publicationId: 'publication-1' }]
    const state = runModel(c, commands)
    expect(state.publications[0]!.confirm).toBe('ignored')
    expect(state.outbox[0]!.status).toBe('pending')
    expect(() => runModel(c, [...commands, { type: 'mark-sent', publicationId: 'publication-1' }])).toThrow('当前生产者')
  })
})
