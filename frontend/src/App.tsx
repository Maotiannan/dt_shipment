import './App.css'
import { useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import BottomTabs from './components/BottomTabs'
import RequireAuth from './components/RequireAuth'
import TopBar from './components/TopBar'
import SideNav from './components/SideNav'
import DashboardPage from './pages/DashboardPage'
import OrdersPage from './pages/OrdersPage'
import AccountsPage from './pages/AccountsPage'
import ProductsPage from './pages/ProductsPage'
import SettlementsPage from './pages/SettlementsPage'
import LoginPage from './pages/LoginPage'

function App() {
  const location = useLocation()
  const showTabs = location.pathname !== '/login'
  const showTopBar = location.pathname !== '/login'
  const [sideCollapsed, setSideCollapsed] = useState(false)

  return (
    <div className="appShell">
      {showTopBar ? (
        <TopBar
          rightExtra={
            <button
              className="ghostBtn ghostBtn-small"
              type="button"
              onClick={() => setSideCollapsed((v) => !v)}
            >
              {sideCollapsed ? '展开导航' : '收起导航'}
            </button>
          }
        />
      ) : null}
      <div className="appBody">
        {showTopBar ? <SideNav collapsed={sideCollapsed} /> : null}
        <main className="appMain">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route
              path="/dashboard"
              element={
                <RequireAuth>
                  <DashboardPage />
                </RequireAuth>
              }
            />
            <Route
              path="/orders"
              element={
                <RequireAuth>
                  <OrdersPage />
                </RequireAuth>
              }
            />
            <Route
              path="/accounts"
              element={
                <RequireAuth>
                  <AccountsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/products"
              element={
                <RequireAuth>
                  <ProductsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/settlements"
              element={
                <RequireAuth>
                  <SettlementsPage />
                </RequireAuth>
              }
            />
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </div>

      {showTabs ? <BottomTabs /> : null}
    </div>
  )
}

export default App
