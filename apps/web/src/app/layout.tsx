import type { Metadata } from 'next'
import '@xyflow/react/dist/style.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'System Design Simulator',
  description: 'Build, run, break and measure system designs.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
