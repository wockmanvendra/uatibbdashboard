import { Navigate, Routes, Route } from 'react-router-dom'
import MainLayout from '../layouts/MainLayout.jsx'
import ProtectedRoute from './ProtectedRoute.jsx'
import ProductGallery from '../pages/ProductGallery.jsx'
import CartPage from '../pages/CartPage.jsx'
import CustomerRegistration from '../pages/CustomerRegistration.jsx'
import Login from '../pages/Login.jsx'
import Dashboard from '../pages/Dashboard.jsx'
import OrderDetailPage from '../pages/OrderDetailPage.jsx'
import CustomerDetailPage from '../pages/CustomerDetailPage.jsx'
import CustomerProfilePage from '../pages/CustomerProfilePage.jsx'
import PaymentMockPage from '../pages/PaymentMockPage.jsx'
import PayLinkPage from '../pages/PayLinkPage.jsx'
import PaymentResultPage from '../pages/PaymentResultPage.jsx'

function AppRoutes() {
  return (
    <Routes>
      {/* Root → redirect to login */}
      <Route path="/" element={<Navigate to="/login" replace />} />

      {/* Login routes — standalone, no Navbar */}
      <Route path="/login" element={<Login />} />
      <Route path="/admin" element={<Login />} />

      {/* CCAvenue payment flow — standalone, public (reached via gateway/external-link redirects, no session guaranteed) */}
      <Route path="/payment/mock" element={<PaymentMockPage />} />
      <Route path="/pay/:token" element={<PayLinkPage />} />
      <Route path="/payment-result" element={<PaymentResultPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<MainLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/dashboard/orders" element={<OrderDetailPage />} />
          <Route path="/dashboard/customers" element={<CustomerDetailPage />} />
          <Route path="/dashboard/profile" element={<CustomerProfilePage />} />
          <Route path="/products" element={<ProductGallery />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/register" element={<CustomerRegistration />} />
        </Route>
      </Route>
    </Routes>
  )
}

export default AppRoutes
