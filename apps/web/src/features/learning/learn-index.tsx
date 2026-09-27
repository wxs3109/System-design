'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowRight, BookOpen, Search } from 'lucide-react'
import { conceptGroups, concepts, filterConcepts, getConcept, learningPaths } from './catalog'
import { LearningNav } from './learning-nav'
import styles from './learning.module.css'

export function LearnIndex({ pathId = '' }: { pathId?: string }) {
  const [query, setQuery] = useState('')
  const [groupId, setGroupId] = useState('')
  const path = learningPaths.find((item) => item.id === pathId)
  const filtered = filterConcepts(query, groupId, path?.id)
  return <main className={styles.page}><LearningNav />
    <header className={styles.hero}><span className={styles.eyebrow}><BookOpen size={15} />基础知识 · {concepts.length} 篇入门讲解</span><h1>从问题出发，理解系统设计</h1><p>先明确发生了什么、什么必须保证，再选择机制。讲解、实验与案例相互关联，也可以独立学习。</p><div className={styles.principles}><span>为什么需要它</span><span>怎样工作</span><span>什么时候不够用</span></div></header>
      <div className={styles.filters}><label className={styles.search}><Search size={17} /><input type="search" aria-label="搜索基础概念" placeholder="搜索幂等、Heartbeat、Outbox…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label className={styles.groupFilter}><span>知识组</span><select aria-label="按知识组筛选" value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">全部知识组</option>{conceptGroups.map((group) => <option value={group.id} key={group.id}>{group.title}</option>)}</select></label></div>
    {!query.trim() && !groupId ? <section className={styles.paths} aria-label="学习路径"><div className={styles.sectionTitle}><h2>从一个问题开始</h2><span>可选路径 · 无需解锁</span></div><div className={styles.pathGrid}>{learningPaths.map((item, index) => <Link key={item.id} href={`/learn?path=${item.id}`} className={styles.pathCard} aria-current={path?.id === item.id ? 'page' : undefined}><span className={styles.number}>0{index + 1}</span><h3>{item.title}</h3><p>{item.description}</p><span className={styles.action}>查看路径 <ArrowRight size={14} /></span></Link>)}</div></section> : null}
    {path && !query.trim() && !groupId ? <section className={styles.pathDetail} aria-label={`${path.title}学习顺序`}><div className={styles.sectionTitle}><h2>{path.title}</h2><Link href="/learn">返回全部知识</Link></div><ol>{path.steps.map((step) => <li key={step.question}><strong>{step.question}</strong><div>{step.conceptIds.map((id) => <Link href={`/learn/${id}`} key={id}>{getConcept(id)!.title}</Link>)}</div></li>)}</ol><p className={styles.note}>下面显示这条路径的知识页。前置链接用于补充理解，不作为访问门槛；实验可用状态在各知识页说明。</p></section> : null}
    <section aria-label="基础概念目录"><div className={styles.sectionTitle}><h2>{path ? '路径中的基础概念' : `${conceptGroups.length} 个基础知识组`}</h2><span aria-live="polite" data-testid="concept-count">{filtered.length} 篇讲解</span></div>
      {!filtered.length ? <div className={styles.empty} role="status"><h3>没有找到匹配的概念</h3><p>可以换一个中英文关键词，或清除知识组筛选。</p><button onClick={() => { setQuery(''); setGroupId('') }}>清除筛选</button>{path ? <Link href="/learn">搜索全部知识</Link> : null}</div> : conceptGroups.map((group, index) => {
        const items = filtered.filter((item) => item.groupId === group.id)
        if (!items.length) return null
        return <section key={group.id} id={group.id} className={styles.group} aria-label={group.title}><div className={styles.groupHeading}><span className={styles.number}>{String(index + 1).padStart(2, '0')}</span><div><h3>{group.title}</h3><p>{group.question}</p></div></div><div className={styles.conceptGrid}>{items.map((item) => <Link key={item.id} href={`/learn/${item.id}`} className={styles.conceptCard} aria-label={`阅读：${item.title}`}><h4>{item.title}<ArrowRight size={16} /></h4><p>{item.question}</p><span>{item.labIds.length ? `${item.labIds.length} 个可运行 Lab` : '知识讲解 · 实验待补充'}</span></Link>)}</div></section>
      })}
    </section><footer className={styles.footer}>知识页解释约束、选择与边界；Lab 验证有限模型中的证据。综合题复用这些能力，各入口分别标明已实现范围。</footer>
  </main>
}
