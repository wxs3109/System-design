import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: ['127.0.0.1'],
  transpilePackages: ['@system-design/model', '@system-design/simulation'],
}

export default nextConfig
