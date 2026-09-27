import { distance, nearby, type SpatialPoint } from '../geography'
import { semanticMessage, type SemanticMessage } from '../../../core/experiments/evidence'
import type { DesignConfig, DesignEvent } from '../model-contracts'

export function runDispatch(config: DesignConfig, commands: readonly string[]) {
  interface Driver extends SpatialPoint { observed: SpatialPoint; reportedAt: number; generation: number; claim?: { trip: string; token: number; until: number; confirmed: boolean } }
  interface Offer { driver: string; token: number; until: number; locationAge: number }
  const drivers: Driver[] = [{ id: 'D1', x: 0.95, y: 0.5 }, { id: 'D2', x: 1.2, y: 0.5 }, { id: 'D3', x: 3.4, y: 1.6 }].map((p) => ({ ...p, observed: { ...p }, reportedAt: 0, generation: 0 }))
  const riders: Record<string, SpatialPoint> = { R1: { id: 'R1', x: 0.8, y: 0.6 }, R2: { id: 'R2', x: 0.8, y: 0.4 } }
  const snapshots: Record<string, string[]> = {}; const offers: Record<string, Offer> = {}
  const assignments: { trip: string; driver: string; token: number; step: number }[] = []
  const rejectedTokens: { driver: string; token: number }[] = []
  const events: DesignEvent[] = []
  const lookups: { trip: string; at: number; candidates: string[]; ages: { driver: string; ms: number }[] }[] = []
  let now = 0; let claims = 0; let conflicts = 0; let staleRejected = 0; let staleAccepted = 0; let duplicateReplies = 0; let expirations = 0; let confirmations = 0; let moves = 0; let outOfRange = 0
  let lastMoveStep = 0; let overlappingSnapshots = 0
  const freshness = config.freshness === 'ignore' ? Infinity : Number(config.freshness)
  const available = (driver: Driver) => !driver.claim || (!driver.claim.confirmed && now >= driver.claim.until)
  for (const [index, command] of commands.entries()) {
    let messages: SemanticMessage[] = []
    if (command === 'tick' || command === 'tick-half') {
      const elapsed = command === 'tick' ? 1000 : 500
      for (const driver of drivers) if (driver.claim && !driver.claim.confirmed && now < driver.claim.until && now + elapsed >= driver.claim.until) expirations++
      now += elapsed; messages = [semanticMessage('dispatch.observation-001', [now])]
    } else if (command === 'move-d1') { drivers[0]!.x = 3.1; moves++; lastMoveStep = index + 1; messages = [semanticMessage('dispatch.observation-002', [])] }
    else if (command === 'report-d2' || command === 'report-all') {
      for (const driver of drivers.filter((d) => command === 'report-all' || d.id === 'D2')) { driver.observed = { id: driver.id, x: driver.x, y: driver.y }; driver.reportedAt = now }
      messages = [semanticMessage('dispatch.observation-003', [command === 'report-all', now])]
    } else if (command === 'lookup-r1' || command === 'lookup-r2') {
      const trip = command.endsWith('r1') ? 'R1' : 'R2'
      const points = drivers.filter((d) => available(d) && now - d.reportedAt < freshness).map((d) => d.observed)
      const found = nearby(points, { ...riders[trip]!, radius: 0.75 }, 'grid', true).results.sort((a, b) => distance(a, riders[trip]!) - distance(b, riders[trip]!) || a.id.localeCompare(b.id))
      snapshots[trip] = found.map((p) => p.id)
      if (snapshots.R1?.[0] && snapshots.R1[0] === snapshots.R2?.[0]) overlappingSnapshots++
      lookups.push({ trip, at: now, candidates: [...snapshots[trip]!], ages: found.map(p => ({ driver: p.id, ms: now - drivers.find(d => d.id === p.id)!.reportedAt })) })
      messages = [semanticMessage('dispatch.observation-004', [trip, snapshots[trip]!])]
    } else if (command === 'offer-r1' || command === 'offer-r2') {
      const trip = command.endsWith('r1') ? 'R1' : 'R2'
      const id = snapshots[trip]?.[0]; const driver = drivers.find((d) => d.id === id)
      if (assignments.some((a) => a.trip === trip)) messages = [semanticMessage('dispatch.observation-005', [trip])]
      else if (!driver) messages = [semanticMessage('dispatch.observation-006', [])]
      else if (now - driver.reportedAt >= freshness) { conflicts++; messages = [semanticMessage('dispatch.observation-007', [])] }
      else if (config.claim === 'cas' && !available(driver)) { conflicts++; messages = [semanticMessage('dispatch.observation-008', [driver.id])] }
      else {
        claims++; const token = ++driver.generation
        driver.claim = { trip, token, until: now + 2000, confirmed: false }
        offers[trip] = { driver: driver.id, token, until: now + 2000, locationAge: now - driver.reportedAt }
        messages = [semanticMessage('dispatch.observation-009', [trip, driver.id, token, now + 2000, config.claim === 'cas'])]
      }
    } else if (command === 'confirm-r1' || command === 'confirm-r2') {
      const trip = command.endsWith('r1') ? 'R1' : 'R2'; confirmations++
      const prior = assignments.find((a) => a.trip === trip)
      const offer = offers[trip]; const driver = drivers.find((d) => d.id === offer?.driver)
      if (prior && config.idempotency === 'trip') { duplicateReplies++; messages = [semanticMessage('dispatch.observation-010', [trip, prior.driver])] }
      else if (!offer || !driver) messages = [semanticMessage('dispatch.observation-011', [trip])]
      else if (config.fencing === 'check' && (now >= offer.until || driver.claim?.token !== offer.token || driver.claim.trip !== trip)) { staleRejected++; rejectedTokens.push({ driver: driver.id, token: offer.token }); messages = [semanticMessage('dispatch.observation-012', [trip, offer.token])] }
      else {
        assignments.push({ trip, driver: driver.id, token: offer.token, step: index + 1 })
        driver.claim = { trip, token: offer.token, until: offer.until, confirmed: true }
        if (offer.locationAge >= 1000) staleAccepted++
        if (distance(driver, riders[trip]!) > 0.75) outOfRange++
        messages = [semanticMessage('dispatch.observation-013', [trip, driver.id, offer.locationAge])]
      }
    } else throw new Error(`Unknown dispatch action: ${command}`)
    events.push({ step: index + 1, action: command, messages })
  }
  const driverDuplicates = assignments.length - new Set(assignments.map((a) => a.driver)).size
  const tripDuplicates = assignments.length - new Set(assignments.map((a) => a.trip)).size
  return { modelVersion: 'dispatch-v1' as const, events, metrics: { now, claims, conflicts, staleRejected, staleAccepted, duplicateReplies, expirations, confirmations, moves, outOfRange, overlappingSnapshots, matchesAfterMove: moves ? assignments.filter((a) => a.step > lastMoveStep).length : 0, newOwnerConfirmed: Number(assignments.some((a) => rejectedTokens.some((r) => r.driver === a.driver && r.token < a.token))), assignments: assignments.length, matchedTrips: new Set(assignments.map((a) => a.trip)).size, driverDuplicates, tripDuplicates, lookupCount: lookups.length }, state: { drivers, riders, offers, assignments, lookups, snapshots, rejectedTokens, now } }
}
