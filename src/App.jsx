import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import AppShell from './components/layout/AppShell'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ProjectsList from './pages/projects/ProjectsList'
import ProjectDetail from './pages/projects/ProjectDetail'
import ProjectForm from './pages/projects/ProjectForm'
import PlotsList from './pages/inventory/PlotsList'
import PlotDetail from './pages/inventory/PlotDetail'
import BulkAddPlots from './pages/inventory/BulkAddPlots'
import BookingsList from './pages/bookings/BookingsList'
import BookingDetail from './pages/bookings/BookingDetail'
import BookingForm from './pages/bookings/BookingForm'
import CustomersList from './pages/customers/CustomersList'
import CustomerDetail from './pages/customers/CustomerDetail'
import BrokersList from './pages/brokers/BrokersList'
import BrokerDetail from './pages/brokers/BrokerDetail'
import AddBroker from './pages/brokers/AddBroker'
import BrokerTeam from './pages/brokers/BrokerTeam'
import BrokerPerformance from './pages/brokers/BrokerPerformance'
import PayoutQueue from './pages/payouts/PayoutQueue'
import CommissionRules from './pages/commission/CommissionRules'
import Reports from './pages/reports/Reports'
import Settings from './pages/settings/Settings'
import WithdrawalRequests from './pages/withdrawals/WithdrawalRequests'
import Expenses from './pages/expenses/Expenses'
import Enquiries from './pages/enquiries/Enquiries'
import Announcements from './pages/announcements/Announcements'
import SupportTickets from './pages/support/SupportTickets'
import BalanceSheet from './pages/finance/BalanceSheet'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="projects" element={<ProjectsList />} />
        <Route path="projects/new" element={<ProjectForm />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="projects/:id/edit" element={<ProjectForm />} />
        <Route path="inventory" element={<PlotsList />} />
        <Route path="inventory/bulk-add" element={<BulkAddPlots />} />
        <Route path="inventory/:id" element={<PlotDetail />} />
        <Route path="bookings" element={<BookingsList />} />
        <Route path="bookings/new" element={<BookingForm />} />
        <Route path="bookings/:id" element={<BookingDetail />} />
        <Route path="customers" element={<CustomersList />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="brokers" element={<BrokersList />} />
        <Route path="brokers/new" element={<AddBroker />} />
        <Route path="brokers/:id" element={<BrokerDetail />} />
        <Route path="brokers/:id/team" element={<BrokerTeam />} />
        <Route path="brokers/:id/performance" element={<BrokerPerformance />} />
        <Route path="payouts" element={<PayoutQueue />} />
        <Route path="commission" element={<CommissionRules />} />
        <Route path="withdrawals" element={<WithdrawalRequests />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="enquiries" element={<Enquiries />} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="support" element={<SupportTickets />} />
        <Route path="balance-sheet" element={<BalanceSheet />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
