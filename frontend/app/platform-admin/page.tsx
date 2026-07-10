import { PlatformAdminPage } from '@/components/layout/platform-admin-page'

export const metadata = {
  title: '平台管理',
  robots: { index: false, follow: false },
}

export default function PlatformAdminRoute() {
  return <PlatformAdminPage />
}
