import AppRoutes from './routes/AppRoutes.jsx'
import { OrdersProvider } from './context/OrdersContext.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { OrderingProvider } from './context/OrderingContext.jsx'
import { CartProvider } from './context/CartContext.jsx'
import { CustomersProvider } from './context/CustomersContext.jsx'
import { DivisionConfigProvider } from './context/DivisionConfigContext.jsx'
import { AppConfigProvider } from './context/AppConfigContext.jsx'

function App() {
  return (
    <AuthProvider>
      <AppConfigProvider>
        <DivisionConfigProvider>
          <OrderingProvider>
            <CartProvider>
              <CustomersProvider>
                <OrdersProvider>
                  <AppRoutes />
                </OrdersProvider>
              </CustomersProvider>
            </CartProvider>
          </OrderingProvider>
        </DivisionConfigProvider>
      </AppConfigProvider>
    </AuthProvider>
  )
}

export default App
