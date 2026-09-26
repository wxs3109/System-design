import Link from 'next/link'
import { BookOpen, FlaskConical, Layers3 } from 'lucide-react'
import styles from './learning.module.css'

export function LearningNav() {
  return <nav className={styles.nav} aria-label="学习导航"><Link className={styles.brand} href="/learn"><Layers3 size={20} /><span>System Design Lab</span></Link><div><Link href="/learn"><BookOpen size={15} />基础知识</Link><Link href="/practice"><FlaskConical size={15} />实验室</Link><Link href="/">自由工作台</Link></div></nav>
}
