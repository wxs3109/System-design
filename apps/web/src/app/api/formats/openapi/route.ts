import { NextResponse } from 'next/server'
import { exportOpenApi, importOpenApi } from '@system-design/formats'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; source?: string; apiId?: string; ownerNodeId?: string; contracts?: Parameters<typeof exportOpenApi>[0] }
    if (body.action === 'import') return NextResponse.json(await importOpenApi(body.source ?? '', { apiId: body.apiId ?? 'api', ownerNodeId: body.ownerNodeId ?? '' }))
    if (body.action === 'export' && body.contracts) return new Response(await exportOpenApi(body.contracts), { headers: { 'content-type': 'application/vnd.oai.openapi+json; charset=utf-8' } })
    return NextResponse.json({ error: 'Expected an import or export request.' }, { status: 400 })
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : 'OpenAPI conversion failed.' }, { status: 422 })
  }
}
