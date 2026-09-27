import { semanticMessage, type SemanticMessage } from '../../../core/experiments/evidence'
import type { DesignConfig, DesignEvent } from '../model-contracts'

export function runNewsFeed(config: DesignConfig, commands: readonly string[]) {
  interface Post { id: string; author: string; sequence: number; deleted: boolean }
  const posts: Post[] = []
  const followers: Record<string, string[]> = { friend: ['u1', 'u2'], celebrity: Array.from({ length: 12 }, (_, i) => `u${i + 1}`) }
  const inbox = Object.fromEntries(followers.celebrity!.map((id) => [id, [] as string[]]))
  const intents: string[] = []
  const jobs: { postId: string; cursor: number }[] = []
  const reads: { reader: string; actual: string[]; expected: string[]; step: number }[] = []
  const events: DesignEvent[] = []
  let online = true; let writes = 0; let examined = 0; let attempts = 0; let duplicateSkips = 0; let deleted = 0; let commitGaps = 0; let redeliveries = 0
  let lastMutation = 0
  const isPushed = (post: Post) => config.strategy === 'push' || (config.strategy === 'hybrid' && followers[post.author]!.length <= 4)
  const deliver = (budget: number) => {
    let work = 0
    while (jobs.length && work < budget) {
      const job = jobs[0]!; const post = posts.find((p) => p.id === job.postId)!
      const audience = followers[post.author]!
      const reader = audience[job.cursor++]!
      attempts++; work++
      if (config.dedup === 'on' && inbox[reader]!.includes(post.id)) duplicateSkips++
      else { inbox[reader]!.push(post.id); writes++ }
      if (job.cursor >= audience.length) jobs.shift()
    }
    return work
  }
  for (const [index, command] of commands.entries()) {
    if (command !== 'read' && command !== 'read-outsider') lastMutation = index + 1
    let messages: SemanticMessage[] = []
    if (command === 'publish-friend' || command === 'publish-celebrity' || command === 'publish-gap') {
      if (!online || posts.length >= 16) messages = [semanticMessage('news-feed.observation-001', [])]
      else {
        const author = command === 'publish-celebrity' ? 'celebrity' : 'friend'
        const post: Post = { id: `p${posts.length + 1}`, author, sequence: posts.length + 1, deleted: false }
        posts.push(post)
        if (isPushed(post) && config.outbox === 'atomic') intents.push(post.id)
        if (command === 'publish-gap') { online = false; commitGaps++; messages = [semanticMessage('news-feed.observation-002', [post.id, intents.includes(post.id)])] }
        else { if (isPushed(post) && config.outbox === 'direct') jobs.push({ postId: post.id, cursor: 0 }); messages = [semanticMessage('news-feed.observation-003', [post.id, isPushed(post), ((isPushed(post))) ? (followers[author]!.length) : null])] }
      }
    } else if (command === 'restart') { online = true; messages = [semanticMessage('news-feed.observation-004', [])] }
    else if (command === 'relay') {
      const count = intents.length
      for (const id of intents.splice(0)) jobs.push({ postId: id, cursor: 0 })
      messages = [semanticMessage('news-feed.observation-005', [count])]
    } else if (command === 'deliver' || command === 'drain') messages = [semanticMessage('news-feed.observation-006', [deliver(command === 'deliver' ? 4 : 192), jobs.length])]
    else if (command === 'redeliver') {
      const post = posts.filter(isPushed).at(-1)
      redeliveries++
      if (post) { jobs.push({ postId: post.id, cursor: 0 }); messages = [semanticMessage('news-feed.observation-007', [post.id])] }
      else messages = [semanticMessage('news-feed.observation-008', [])]
    } else if (command === 'delete-friend') {
      const post = posts.find((p) => p.author === 'friend' && !p.deleted)
      if (post) { post.deleted = true; deleted++; messages = [semanticMessage('news-feed.observation-009', [post.id])] } else messages = [semanticMessage('news-feed.observation-010', [])]
    } else if (command === 'read' || command === 'read-outsider') {
      const reader = command === 'read' ? 'u1' : 'u12'
      const followed = Object.keys(followers).filter((author) => followers[author]!.includes(reader))
      const pushed = inbox[reader]!.map((id) => posts.find((p) => p.id === id)!)
      const pulled = posts.filter((p) => followed.includes(p.author) && !isPushed(p) && !p.deleted)
      examined += pushed.length + posts.filter((p) => followed.includes(p.author) && !isPushed(p)).length
      const candidates = [...pushed, ...pulled].filter((p) => config.hydrate !== 'source' || (!p.deleted && followed.includes(p.author)))
      const actual = candidates.sort((a, b) => b.sequence - a.sequence).map((p) => p.id)
      const expected = posts.filter((p) => !p.deleted && followed.includes(p.author)).sort((a, b) => b.sequence - a.sequence).map((p) => p.id)
      reads.push({ reader, actual, expected, step: index + 1 }); messages = [semanticMessage('news-feed.observation-011', [reader, actual, expected])]
    } else throw new Error(`Unknown feed action: ${command}`)
    events.push({ step: index + 1, action: command, messages })
  }
  const last = reads.filter((r) => r.reader === 'u1').at(-1)
  const outsider = reads.filter((r) => r.reader === 'u12').at(-1)
  const correct = (read: typeof last) => !!read && read.step >= lastMutation && JSON.stringify(read.actual) === JSON.stringify(read.expected)
  return { modelVersion: 'news-feed-v1' as const, events, metrics: { posts: posts.length, celebrityPosts: posts.filter((p) => p.author === 'celebrity').length, ordinaryPosts: posts.filter((p) => p.author === 'friend').length, fanoutWrites: writes, deliveryAttempts: attempts, duplicateSkips, readExamined: examined, pending: jobs.reduce((sum, j) => sum + followers[posts.find((p) => p.id === j.postId)!.author]!.length - j.cursor, 0) + intents.length, reads: reads.length, correctRead: Number(correct(last)), correctOutsider: Number(correct(outsider)), deleted, commitGaps, redeliveries }, state: { posts, followers, inbox, intents, jobs, reads, online } }
}
