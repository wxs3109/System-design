import type { Metadata } from 'next'
import '@xyflow/react/dist/style.css'
import 'vis-timeline/styles/vis-timeline-graph2d.min.css'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { I18nProvider } from '@/lib/i18n'

export const metadata: Metadata = {
  title: 'System Design Simulator',
  description: 'Build, run, break and measure system designs.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body><ThemeProvider><I18nProvider>{children}</I18nProvider></ThemeProvider></body>
    </html>
  )
}
