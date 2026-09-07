import Link from 'next/link'
import { ArrowRight, FlaskConical, Layers3 } from 'lucide-react'
import { exercises } from '@/features/practice/exercises'
import styles from '@/features/practice/practice.module.css'

export const metadata = { title: '系统设计练习 · System Design Simulator' }

export default function PracticePage() {
  return <main className={styles.catalog}>
    <nav className={styles.catalogNav} aria-label="主导航"><Link className={styles.wordmark} href="/"><Layers3 size={20} />System Design Lab</Link><Link href="/">自由工作台 <ArrowRight size={15} /></Link></nav>
    <section className={styles.hero}>
      <span className={styles.eyebrow}><FlaskConical size={15} />练习 · 观察 · 解释</span>
      <h1>系统设计练习</h1>
      <p>先预测，再运行。用一个可以亲手调整的实验，弄清设计为什么有效。</p>
      <div className={styles.journey}><span>01 读取约束</span><ArrowRight size={14} /><span>02 调整设计</span><ArrowRight size={14} /><span>03 用证据复盘</span></div>
    </section>
    <section className={styles.exerciseGrid} aria-label="可用练习">
      {exercises.map((exercise, index) => <Link className={styles.exerciseCard} key={exercise.id} aria-label={exercise.title} href={`/practice/${exercise.id}`}>
        <div className={styles.cardTop}><span className={styles.cardNumber}>{String(index + 1).padStart(2, '0')}</span><span className={styles.pill}>容量与排队 · 入门</span></div>
        <h2>{exercise.title}</h2><p>{exercise.summary}</p>
        <div className={styles.miniFlow} aria-hidden="true"><span>流量</span><ArrowRight size={16} /><span>API Service</span><ArrowRight size={16} /><span>运行证据</span></div>
        <div className={styles.cardFooter}><span>约 10 分钟 · 本地保存</span><strong>开始练习 <ArrowRight size={16} /></strong></div>
      </Link>)}
    </section>
    <p className={styles.catalogNote}>组件运行在简化的仿真模型中。无需部署服务；结果用于学习设计取舍。</p>
  </main>
}
