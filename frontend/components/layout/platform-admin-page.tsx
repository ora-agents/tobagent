'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { BarChart3, KeyRound, LogOut, RefreshCw, Search, UsersRound, WalletCards } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { LoadingPlaceholder } from '@/components/ui/loading-placeholder'
import { StatusNotice } from '@/components/ui/status-notice'
import { backendFetch } from '@/lib/api/backend-fetch'

type Overview = {
  users: number
  registrationsToday: number
  agentProfiles: number
  sharedAgents: number
  purchases: number
  orders: number
  paidOrders: number
  paidAmountCents: number
}

type UserRecord = {
  id: string
  username: string
  phone: string | null
  email: string | null
  createdAt: string
}

type OrderRecord = {
  id: string
  outTradeNo: string
  buyerUserId: string
  buyerUsername: string | null
  sellerUserId: string
  sellerUsername: string | null
  amountCents: number
  currency: string
  status: string
  provider: string
  createdAt: string
  paidAt: string | null
}

type Paged<T> = { total: number; items: T[] }
type View = 'users' | 'orders'

function formatDate(value: string | null) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('zh-CN', { hour12: false })
}

function formatMoney(cents: number, currency: string = 'CNY') {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(cents / 100)
}

function StatCard({ label, value, description }: { label: string; value: string | number; description: string }) {
  return (
    <Card>
      <CardHeader className="gap-1 p-4 pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 text-xs text-muted-foreground">{description}</CardContent>
    </Card>
  )
}

export function PlatformAdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [registered, setRegistered] = useState<boolean | null>(null)
  const [adminUsername, setAdminUsername] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [view, setView] = useState<View>('users')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [users, setUsers] = useState<Paged<UserRecord>>({ total: 0, items: [] })
  const [orders, setOrders] = useState<Paged<OrderRecord>>({ total: 0, items: [] })

  const loadData = useCallback(async (nextView = view, nextOffset = offset, nextSearch = search) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ offset: String(nextOffset), limit: '50' })
      if (nextSearch.trim()) params.set('search', nextSearch.trim())
      const [overviewResponse, listResponse] = await Promise.all([
        backendFetch('/api/platform-admin/overview'),
        backendFetch(`/api/platform-admin/${nextView}?${params}`),
      ])
      if (overviewResponse.status === 401 || listResponse.status === 401) {
        setAuthenticated(false)
        return
      }
      if (!overviewResponse.ok || !listResponse.ok) throw new Error('无法加载平台数据，请稍后重试。')
      setOverview(await overviewResponse.json())
      if (nextView === 'users') setUsers(await listResponse.json())
      else setOrders(await listResponse.json())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法加载平台数据，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }, [offset, search, view])

  useEffect(() => {
    let active = true
    Promise.all([backendFetch('/api/platform-admin/session'), backendFetch('/api/platform-admin/setup-status')])
      .then(([response, setupResponse]) => {
        if (!active) return
        setAuthenticated(response.ok)
        if (setupResponse.ok) void setupResponse.json().then((payload) => active && setRegistered(payload.registered))
      })
      .catch(() => active && setAuthenticated(false))
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (authenticated) void loadData()
  }, [authenticated, loadData])

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const endpoint = registered ? '/api/platform-admin/session' : '/api/platform-admin/register'
      const response = await backendFetch(endpoint, { method: 'POST', json: { username: adminUsername, password: adminPassword, totpCode }, anonymous: true })
      if (!response.ok) throw new Error(response.status === 404 ? '平台管理未在服务器上启用。' : registered ? '账号、密码或动态验证码无效。' : '注册失败：请确认动态验证码有效且尚未注册管理员。')
      setAdminPassword('')
      setTotpCode('')
      if (!registered) {
        setRegistered(true)
        return
      }
      setAuthenticated(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法验证管理员密钥。')
    } finally {
      setSubmitting(false)
    }
  }

  const changeView = (nextView: View) => {
    setView(nextView)
    setOffset(0)
    void loadData(nextView, 0, search)
  }

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setOffset(0)
    void loadData(view, 0, search)
  }

  const logout = async () => {
    const code = window.prompt('请输入 Google Authenticator 的 6 位动态验证码以退出')
    if (!code) return
    const response = await backendFetch('/api/platform-admin/session', { method: 'DELETE', json: { totpCode: code } })
    if (!response.ok) {
      setError('动态验证码无效，未退出当前会话。')
      return
    }
    setOverview(null)
    setAuthenticated(false)
  }

  if (authenticated === null) {
    return <div className="flex min-h-svh items-center justify-center bg-background"><LoadingPlaceholder variant="button" className="w-48" /></div>
  }

  if (!authenticated) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background p-4 text-foreground">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><KeyRound /></div>
            <CardTitle>平台管理</CardTitle>
            <CardDescription>{registered ? '输入管理员账号、密码和 Google Authenticator 动态验证码。' : '先使用 Google Authenticator 扫描部署人员提供的二维码，再注册首个管理员账号。'}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitLogin} className="flex flex-col gap-4">
              {error && <StatusNotice tone="error" wrap>{error}</StatusNotice>}
              <FormField id="platform-admin-username" label="管理员账号" required>
                <Input id="platform-admin-username" autoComplete="username" value={adminUsername} onChange={(event) => setAdminUsername(event.target.value)} disabled={submitting || registered === null} />
              </FormField>
              <FormField id="platform-admin-password" label="密码" required>
                <Input id="platform-admin-password" type="password" autoComplete={registered ? 'current-password' : 'new-password'} value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} disabled={submitting || registered === null} />
              </FormField>
              <FormField id="platform-admin-totp" label="Google Authenticator 动态验证码" required>
                <Input id="platform-admin-totp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ''))} disabled={submitting || registered === null} />
              </FormField>
              <Button type="submit" disabled={submitting || registered === null || !adminUsername || !adminPassword || totpCode.length !== 6}>{submitting ? '验证中…' : registered ? '进入管理后台' : '注册管理员账号'}</Button>
            </form>
          </CardContent>
        </Card>
      </main>
    )
  }

  const page = view === 'users' ? users : orders
  const canGoBack = offset > 0
  const canGoForward = offset + 50 < page.total

  return (
    <main className="min-h-svh bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-primary"><BarChart3 /><span className="text-sm font-semibold">平台管理</span></div>
            <h1 className="mt-1 text-2xl font-semibold">运营概览</h1>
            <p className="mt-1 text-sm text-muted-foreground">全平台用户、注册和支付订单数据。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => void loadData()} disabled={loading}><RefreshCw data-icon="inline-start" />刷新</Button>
            <Button type="button" variant="secondary" onClick={() => void logout()}><LogOut data-icon="inline-start" />退出</Button>
          </div>
        </header>
        {error && <StatusNotice tone="error" wrap>{error}</StatusNotice>}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="平台用户" value={overview?.users ?? '—'} description={`今日注册 ${overview?.registrationsToday ?? 0} 人`} />
          <StatCard label="支付订单" value={overview?.orders ?? '—'} description={`已支付 ${overview?.paidOrders ?? 0} 笔`} />
          <StatCard label="已支付金额" value={overview ? formatMoney(overview.paidAmountCents) : '—'} description={`购买记录 ${overview?.purchases ?? 0} 条`} />
          <StatCard label="智能体" value={overview?.agentProfiles ?? '—'} description={`已分享 ${overview?.sharedAgents ?? 0} 个`} />
        </section>
        <Card>
          <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg">数据明细</CardTitle>
              <CardDescription>{view === 'users' ? '可查看已注册平台用户。' : '可查看全平台支付订单。'}</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant={view === 'users' ? 'default' : 'secondary'} size="sm" onClick={() => changeView('users')}><UsersRound data-icon="inline-start" />用户</Button>
              <Button type="button" variant={view === 'orders' ? 'default' : 'secondary'} size="sm" onClick={() => changeView('orders')}><WalletCards data-icon="inline-start" />订单</Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form onSubmit={submitSearch} className="flex gap-2">
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={view === 'users' ? '搜索用户名、手机号或邮箱' : '搜索订单号、状态或用户名'} />
              <Button type="submit" variant="secondary" disabled={loading}><Search data-icon="inline-start" />搜索</Button>
            </form>
            <div className="overflow-x-auto">
              {view === 'users' ? <UsersTable items={users.items} loading={loading} /> : <OrdersTable items={orders.items} loading={loading} />}
            </div>
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>共 {page.total} 条</span>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" size="sm" disabled={!canGoBack || loading} onClick={() => { const next = Math.max(0, offset - 50); setOffset(next); void loadData(view, next, search) }}>上一页</Button>
                <Button type="button" variant="secondary" size="sm" disabled={!canGoForward || loading} onClick={() => { const next = offset + 50; setOffset(next); void loadData(view, next, search) }}>下一页</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

function UsersTable({ items, loading }: { items: UserRecord[]; loading: boolean }) {
  return <table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-muted text-muted-foreground"><tr><th className="p-3 font-medium">用户</th><th className="p-3 font-medium">手机号</th><th className="p-3 font-medium">邮箱</th><th className="p-3 font-medium">注册时间</th></tr></thead><tbody>{loading ? <tr><td className="p-3 text-muted-foreground" colSpan={4}>加载中…</td></tr> : items.length ? items.map((user) => <tr key={user.id} className="border-b border-border"><td className="p-3"><div className="font-medium">{user.username}</div><div className="text-xs text-muted-foreground">{user.id}</div></td><td className="p-3">{user.phone || '—'}</td><td className="p-3">{user.email || '—'}</td><td className="p-3">{formatDate(user.createdAt)}</td></tr>) : <tr><td className="p-3 text-muted-foreground" colSpan={4}>没有匹配的用户。</td></tr>}</tbody></table>
}

function OrdersTable({ items, loading }: { items: OrderRecord[]; loading: boolean }) {
  return <table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-muted text-muted-foreground"><tr><th className="p-3 font-medium">订单</th><th className="p-3 font-medium">买家</th><th className="p-3 font-medium">卖家</th><th className="p-3 font-medium">金额</th><th className="p-3 font-medium">状态</th><th className="p-3 font-medium">创建时间</th></tr></thead><tbody>{loading ? <tr><td className="p-3 text-muted-foreground" colSpan={6}>加载中…</td></tr> : items.length ? items.map((order) => <tr key={order.id} className="border-b border-border"><td className="p-3 font-mono text-xs">{order.outTradeNo}</td><td className="p-3">{order.buyerUsername || order.buyerUserId}</td><td className="p-3">{order.sellerUsername || order.sellerUserId}</td><td className="p-3">{formatMoney(order.amountCents, order.currency)}</td><td className="p-3">{order.status}</td><td className="p-3">{formatDate(order.createdAt)}</td></tr>) : <tr><td className="p-3 text-muted-foreground" colSpan={6}>没有匹配的订单。</td></tr>}</tbody></table>
}
