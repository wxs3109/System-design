import { LearnIndex } from '@/features/learning/learn-index'
import { learningPaths } from '@/features/learning/catalog'

export const metadata = { title: '基础知识 · System Design Lab', description: '从常见问题与故障理解系统设计基础，连接概念、交互实验和应用案例。' }
export default async function LearnPage({ searchParams }: { searchParams: Promise<{ path?: string | string[] }> }) {
  const params = await searchParams
  const pathId = typeof params.path === 'string' && learningPaths.some((path) => path.id === params.path) ? params.path : ''
  return <LearnIndex key={pathId} pathId={pathId} />
}
