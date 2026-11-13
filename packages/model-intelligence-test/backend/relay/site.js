/**
 * Adapted relay sites. A site is a third-party model relay (中转站) whose public
 * channel directory is readable anonymously; every capability below is declared
 * here so the UI can never pretend to offer something the site does not expose.
 */
export const SORTS = [
  {id: 'comprehensive', label: '综合推荐'},
  {id: 'price_asc', label: '价格从低到高'},
  {id: 'price_desc', label: '价格从高到低'},
  {id: 'success_desc', label: '成功率优先'},
  {id: 'p50_asc', label: '延迟优先'},
];

/** Anonymous endpoints verified against the live site; anything else needs a login. */
export const SITES = [
  {
    id: 'a6api',
    name: 'a6api',
    label: 'a6api 中转站',
    webUrl: 'https://a6api.vip',
    apiUrl: 'https://api.a6api.vip',
    docsUrl: 'https://a6api.vip/docs',
    anonymous: true,
    note: '公开渠道目录匿名读取；SVG 检测需要在设置「API 适配站点」填写系统访问令牌与用户 ID；固定商家、加入路由暂未提供。',
    endpoints: {channels: '/api/marketplace/public/channels/search', hotModels: '/api/marketplace/hot-models'},
  },
];

export function siteOf(id) {
  return SITES.find(site => site.id === id);
}

export function sortOf(id) {
  return SORTS.find(sort => sort.id === id) ?? SORTS[0];
}
