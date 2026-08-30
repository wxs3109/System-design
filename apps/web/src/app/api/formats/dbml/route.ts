import { NextResponse } from 'next/server'
import { exportDbml, importDbml } from '@system-design/formats'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; source?: string; options?: Parameters<typeof importDbml>[1]; model?: Parameters<typeof exportDbml>[0] }
    if (body.action === 'import' && body.options) return NextResponse.json(importDbml(body.source ?? '', body.options))
    if (body.action === 'export' && body.model) return new Response(exportDbml(body.model), { headers: { 'content-type': 'text/plain; charset=utf-8' } })
    return NextResponse.json({ error: 'Expected an import or export request.' }, { status: 400 })
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : 'DBML conversion failed.' }, { status: 422 })
  }
}
