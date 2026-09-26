import Link from 'next/link'
import { ArrowRight, FlaskConical } from 'lucide-react'
import { practiceCatalog } from '@/features/practice/catalog'
import { LearningNav } from '@/features/learning/learning-nav'
import { designExercises } from '@/features/design/catalog'
import { productDesigns } from '@/features/design/product-catalog'
import styles from '@/features/practice/practice.module.css'

export const metadata = { title: '系统设计练习 · System Design Simulator' }

export default function PracticePage() {
  return <main className={styles.catalog}>
    <LearningNav />
    <section className={styles.hero}>
      <span className={styles.eyebrow}><FlaskConical size={15} />练习 · 观察 · 解释</span>
      <h1>系统设计练习</h1>
      <p>先预测，再运行。用一个可以亲手调整的实验，弄清设计为什么有效。</p>
      <p><Link className={styles.knowledgeEntry} href="/learn">先理解原理：浏览基础知识与学习路径 <ArrowRight size={15} /></Link></p>
      <div className={styles.journey}><span>01 读取约束</span><ArrowRight size={14} /><span>02 调整设计</span><ArrowRight size={14} /><span>03 用证据复盘</span></div>
    </section>
    <h2>综合设计题</h2><p className={styles.catalogNote}>从产品痛点出发，搭建设计、验证证据并解释取舍。每题明确已验证的范围。</p>
    <section className={styles.exerciseGrid} aria-label="综合设计题">{[...designExercises, ...productDesigns].map((exercise) => <Link className={styles.exerciseCard} key={exercise.id} aria-label={exercise.title} href={`/practice/${exercise.id}`}><span className={styles.pill}>综合设计 · 可交互</span><h2>{exercise.title}</h2><p>{exercise.summary}</p><div className={styles.cardFooter}><span>约 {exercise.estimatedMinutes} 分钟 · 本地保存</span><strong>开始设计 <ArrowRight size={16} /></strong></div></Link>)}</section>
    <h2 style={{ marginTop: 44 }}>基础机制 Lab</h2>
    <section className={styles.exerciseGrid} aria-label="可用练习">
      {practiceCatalog.map((exercise, index) => <Link className={styles.exerciseCard} key={exercise.id} aria-label={exercise.title} href={`/practice/${exercise.id}`}>
        <div className={styles.cardTop}><span className={styles.cardNumber}>{String(index + 1).padStart(2, '0')}</span><span className={styles.pill}>{exercise.category} · {exercise.difficulty}</span></div>
        <h2>{exercise.title}</h2><p>{exercise.summary}</p>
        <div className={styles.miniFlow} aria-hidden="true">{exercise.flow.map((step, stepIndex) => <span className={styles.flowStep} key={`${stepIndex}:${step}`}>{stepIndex > 0 ? <ArrowRight size={16} /> : null}<span>{step}</span></span>)}</div>
        <div className={styles.cardFooter}><span>约 {exercise.estimatedMinutes} 分钟 · 本地保存</span><strong>开始练习 <ArrowRight size={16} /></strong></div>
      </Link>)}
    </section>
    <p className={styles.catalogNote}>组件运行在简化的仿真模型中。无需部署服务；结果用于学习设计取舍。</p>
  </main>
}
