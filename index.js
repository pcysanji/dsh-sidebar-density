/**
 * dsh-sidebar-density —— 宿主侧。
 *
 * 只做一件事：把本机已安装的字体族列表交给页面。
 *
 * 为什么放宿主侧：浏览器里的 `queryLocalFonts()` 需要用户手势授权，在插件的
 * 只读探测里经常直接抛错或返回空，字体搜索因此形同虚设。宿主跑在 Electron
 * 主进程里，可以自己读系统字体，页面只要拿一个 JSON。
 *
 * 路由挂在 `ctx.webServer` 上，只读、无副作用、结果缓存一次。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** 字体列表在进程内缓存，避免每次开面板都重新枚举。 */
let cache = null
/** 并发去重：同时开两个面板不重复枚举。 */
let pending = null

/**
 * PowerShell 枚举本机字体族。
 *
 * 两个必须点：
 * 1. 先设 `[Console]::OutputEncoding` 为 UTF-8，否则中文族名按 GBK 出来是乱码；
 * 2. 用 `InstalledFontCollection` 而不是读注册表 —— 注册表键里查不到苹方这类
 *    用户区/非常规注册的字体（实测注册表 3090 条里没有 PingFang，而字体集合
 *    1762 条里有「苹方 常规」）。
 * @returns 原始输出文本。
 */
async function readInstalledFonts() {
  if (process.platform !== 'win32') return ''
  const script = [
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    'Add-Type -AssemblyName System.Drawing',
    '(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }',
  ].join('\n')
  const { stdout } = await run(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: 20000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
  )
  return stdout
}

/**
 * 清洗族名。
 *
 * - 丢掉空行、扩展名条目；
 * - 去掉 `(TrueType)` / `(非商业使用)` 这类括号注记；
 * - 把 `苹方 常规`、`苹方 粗体` 这类「族名 + 字重」并回 `苹方`；
 * - 保留以「.」开头的隐藏族名（`.萍方-简` 是真名，浏览器认）。
 * @param text - PowerShell 原始输出。
 * @returns 去重排序后的族名。
 */
function normalize(text) {
  const WEIGHTS = /(?:\s|^)(?:Thin|ExtraLight|UltraLight|Light|Regular|Normal|Medium|SemiBold|DemiBold|Bold|ExtraBold|UltraBold|Black|Heavy|Italic|Oblique|常规|中等|细体|特细|粗体|中黑|极细|标准|细|中等偏细)$/u
  const families = new Set()
  for (const raw of String(text).split(/\r?\n/u)) {
    let name = raw.trim()
    if (name === '') continue
    // 括号注记：可能是全角或半角
    name = name.replace(/[（(][^（()）]*[)）]\s*$/u, '').trim()
    if (/\.(?:ttf|ttc|otf|fon|pfm|otc)$/iu.test(name)) continue
    // 「族名 + 字重」并回族名；反复剥，处理「苹方 中等 斜体」这类叠字
    for (let i = 0; i < 3; i += 1) {
      const next = name.replace(WEIGHTS, '').trim()
      if (next === name || next === '') break
      name = next
    }
    if (name === '') continue
    families.add(name)
  }
  return [...families].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

/** 取字体列表，带缓存与并发合并。 */
async function loadFonts() {
  if (cache !== null) return cache
  if (pending !== null) return pending
  pending = (async () => {
    try {
      cache = normalize(await readInstalledFonts())
    } catch {
      cache = []
    } finally {
      pending = null
    }
    return cache
  })()
  return pending
}

/**
 * 宿主侧入口。
 *
 * `inject` 必须显式导出：Cordis 只有在所列服务就绪之后才调用 apply，
 * 不声明的话 apply 会在 webServer 服务挂上之前就跑完，注册静默失效
 * （表现就是路由 404）。
 */
export const inject = ['webServer']

/**
 * @param ctx - Host 栈上的插件 context。
 */
export function apply(ctx) {
  if (ctx.webServer === undefined) return
  const dispose = ctx.webServer.register({
    kind: 'exact',
    path: '/sidebar-density/fonts',
    handler: async (request, response) => {
      const fonts = await loadFonts()
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        // 装完字体重开 DSH 才会变；这个缓存同时挡住面板反复开关的打点。
        'cache-control': 'private, max-age=600',
      })
      response.end(JSON.stringify({ platform: process.platform, fonts }))
    },
  })
  ctx.effect(() => dispose, 'dsh-sidebar-density: font route')
}
