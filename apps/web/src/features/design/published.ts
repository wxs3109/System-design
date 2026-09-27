/** Small navigation metadata: no model imports in the knowledge catalog. */
export const publishedDesigns: Readonly<Record<string, { id: string; scope: string }>> = {
  'CASE-01': { id: 'design-short-link', scope: '跳转读取路径' },
  'CASE-02': { id: 'design-news-feed', scope: '分发、名人热点与故障恢复' },
  'CASE-03': { id: 'design-object-storage', scope: '分片提交、持久性与版本读取' },
  'CASE-04': { id: 'design-maps', scope: '附近查询、位置更新与道路寻路' },
}
