import Link from 'next/link'
import { ArrowRight, BookOpen, FlaskConical } from 'lucide-react'
import { getPracticeEntry } from '../practice/catalog'
import { caseContexts, conceptGroups, getConcept, learningPaths, plannedLabs } from './catalog'
import { conceptBodies, readingSources } from './content'
import type { Concept } from './types'
import { LearningNav } from './learning-nav'
import styles from './learning.module.css'

export function ConceptPage({ concept }: { concept: Concept }) {
  const body = conceptBodies[concept.id]!
  const group = conceptGroups.find((item) => item.id === concept.groupId)!
  const labs = concept.labIds.map((id) => getPracticeEntry(id)!)
  const candidates = plannedLabs.filter((lab) => (lab.conceptIds as readonly string[]).includes(concept.id))
  const paths = learningPaths.filter((path) => path.steps.some((step) => step.conceptIds.includes(concept.id)))
  return <main className={styles.page}><LearningNav /><div className={styles.breadcrumb}><Link href="/learn">基础知识</Link><span>/</span><Link href={`/learn#${group.id}`}>{group.title}</Link></div>
    <header className={styles.articleHero}><span className={styles.eyebrow}>入门讲解 · 可独立阅读</span><h1>{concept.title}</h1><p>{concept.summary}</p><div className={styles.aliases}>{concept.aliases.map((alias) => <span key={alias}>{alias}</span>)}</div></header>
    <div className={styles.articleLayout}>
      <article className={styles.article}>
        <section id="problem" className={styles.problem}><span className={styles.eyebrow}>先看问题</span><h2>{concept.question}</h2><p>{body.problem}</p></section>
        <section id="example"><h2>一个最小例子</h2><ol className={styles.example}>{body.example.map((step, index) => <li key={step}><span>{index + 1}</span><p>{step}</p></li>)}</ol></section>
        <section id="mechanism"><h2>机制怎样工作</h2>{body.mechanism.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</section>
        <section id="conditions"><h2>保证成立的条件</h2><ul>{body.conditions.map((condition) => <li key={condition}>{condition}</li>)}</ul></section>
        <section id="counterexample" className={styles.counterexample}><span className={styles.eyebrow}>检查边界</span><h2>一个失效反例</h2><p>{body.counterexample}</p></section>
        <section id="self-check" className={styles.selfCheck}><h2>停下来想一想</h2><p>{body.check.question}</p><details><summary>展开参考解释</summary><p>{body.check.answer}</p></details><small>这是阅读自测，不会记录为实验通过或已掌握。</small></section>
        <section id="labs" aria-label="相关实验"><h2><FlaskConical size={20} />用实验验证</h2>{labs.length ? <div className={styles.labCards}>{labs.map((lab) => <Link href={`/practice/${lab.id}`} className={styles.labCard} key={lab.id}><span className={styles.ready}>可运行 Lab</span><h3>{lab.title}</h3><p>{lab.summary}</p><strong>开始实验 <ArrowRight size={15} /></strong></Link>)}</div> : <p>这篇讲解已可阅读，对应的交互实验尚未实现。</p>}
          {candidates.length ? <div className={styles.planned}>{candidates.map((lab) => <div key={lab.id}><span>实验规划中</span><strong>{lab.title}</strong></div>)}</div> : null}
          <p className={styles.note}>一个 Lab 可以关联多个概念。进入实验后仍以该题的实际模型范围为准；阅读内容不会改变组件或评分规则。</p>
        </section>
        <section id="cases" aria-label="应用案例"><h2>把概念带回案例</h2><div className={styles.caseCards}>{concept.caseIds.map((id) => { const item = caseContexts.find((entry) => entry.id === id)!; return <div key={id}><span>应用背景 · 设计题待实现</span><h3>{item.title}</h3><p>{item.question}</p></div> })}</div></section>
        <section id="sources"><h2>继续阅读</h2><ul className={styles.sources}>{body.sourceIds.map((id) => <li key={id}><a href={readingSources[id]!.url} target="_blank" rel="noreferrer">{readingSources[id]!.title} ↗</a></li>)}</ul><p className={styles.note}>本文是面向入门的概念整理；具体系统的保证还需核对其协议、配置与故障模型。</p></section>
      </article>
      <aside className={styles.articleAside} aria-label="知识导航">
        <nav aria-label="本页目录"><h2>本页内容</h2>{[['problem', '要解决的问题'], ['example', '最小例子'], ['mechanism', '工作机制'], ['conditions', '成立条件'], ['counterexample', '失效反例'], ['self-check', '阅读自测'], ['labs', '相关实验'], ['cases', '应用案例']].map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
        <section><h2>相关前置知识</h2>{concept.prerequisiteIds.length ? concept.prerequisiteIds.map((id) => <Link key={id} href={`/learn/${id}`}><BookOpen size={14} />{getConcept(id)!.title}</Link>) : <p>可以从这篇开始，不需要先完成其他题目。</p>}</section>
        {paths.length ? <section><h2>所在学习路径</h2>{paths.map((path) => <Link key={path.id} href={`/learn?path=${path.id}`}>{path.title}<ArrowRight size={14} /></Link>)}</section> : null}
        <Link className={styles.returnLink} href="/learn">浏览全部基础知识</Link>
      </aside>
    </div><footer className={styles.footer}>理解机制 → 验证边界 → 应用到设计。阅读、实验与案例之间可自由跳转。</footer>
  </main>
}
