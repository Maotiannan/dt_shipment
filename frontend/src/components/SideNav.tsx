import { Link, useLocation } from 'react-router-dom'

const items = [
  { to: '/dashboard', label: '首页' },
  { to: '/orders', label: '订单' },
  { to: '/accounts', label: '账号' },
  { to: '/products', label: '产品库' },
  { to: '/settlements', label: '结算' },
  { to: '/settings', label: '设置' },
]

export default function SideNav({ collapsed }: { collapsed?: boolean }) {
  const { pathname } = useLocation()

  return (
    <aside className={collapsed ? 'sideNav sideNav-collapsed' : 'sideNav'} aria-label="侧边导航">
      <div className="sideNavHeader">{collapsed ? '管家' : '发货管家'}</div>
      <nav className="sideNavList">
        {items.map((it) => {
          const active = pathname === it.to
          return (
            <Link
              key={it.to}
              to={it.to}
              className={active ? 'sideNavItem active' : 'sideNavItem'}
            >
              <span className="sideNavItemLabel">{it.label}</span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
