import { Link, useLocation } from 'react-router-dom'

const tabs = [
  { to: '/dashboard', label: '首页' },
  { to: '/orders', label: '订单' },
  { to: '/accounts', label: '账号' },
  { to: '/products', label: '产品库' },
  { to: '/settlements', label: '结算' },
]

export default function BottomTabs() {
  const { pathname } = useLocation()

  return (
    <nav className="bottomTabs" aria-label="底部导航">
      {tabs.map((t) => {
        const active = pathname === t.to
        return (
          <Link
            key={t.to}
            to={t.to}
            className={active ? 'bottomTab active' : 'bottomTab'}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}

