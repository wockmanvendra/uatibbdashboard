import { createContext, useContext, useEffect, useState } from 'react'
import { nextOrderStatus } from '../data/workflow.js'
import { ordersApi } from '../lib/api.js'
import { useAuth } from './AuthContext.jsx'
import { useDivisionConfig } from './DivisionConfigContext.jsx'

const OrdersContext = createContext(null)

export function OrdersProvider({ children }) {
  const { user } = useAuth()
  const { rules } = useDivisionConfig()
  const [orders, setOrders] = useState([])
  const [ordersError, setOrdersError] = useState(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!user) return
    // dm has cross-division access (backend scope no longer restricts by
    // division for dm) — fetch every cfa-scoped order and let the dm
    // dashboard's division picker narrow it down client-side.
    const params = (user.divisionCode && user.usertype !== 'dm') ? { division_code: user.divisionCode } : {}
    setOrdersError(null)
    ordersApi.list(params).then(setOrders).catch(err => {
      // Surfaced as ordersError rather than left as a silently-empty list —
      // an empty array here is otherwise indistinguishable from "this user
      // genuinely has zero orders."
      console.error(err)
      setOrdersError(err.message || 'Failed to load orders.')
    })
  }, [user?.divisionCode, user?.usertype, reloadToken])

  const reloadOrders = () => setReloadToken(t => t + 1)

  // Shared by placeOrder and resubmitOrder — everything except who placed it / who it's for.
  // deliveryAddress: { address, pinCode, city, state }
  const buildOrderPayload = (cartItems, totals, extraData, paymentMethod, chequeDetails, remarks, deliveryAddress) => {
    const combinedExtraData = (extraData || chequeDetails)
      ? { ...(extraData || {}), ...(chequeDetails ? { chequeDetails } : {}) }
      : null
    return {
      total_units:    totals.totalUnits,
      total_payable:  totals.totalPayable,
      total_discount: totals.totalDiscount,
      extra_data:     combinedExtraData,
      payment_method: paymentMethod,
      remarks:        remarks || null,
      delivery_address:  deliveryAddress?.address ?? null,
      delivery_pin_code: deliveryAddress?.pinCode ?? null,
      delivery_city:     deliveryAddress?.city    ?? null,
      delivery_state:    deliveryAddress?.state   ?? null,
      items: cartItems.map(item => ({
        product_id:     item.productId,
        product_name:   item.productName,
        quantity:       item.orderedQty,
        free_qty:       item.freeQty    ?? 0,
        unit_price:     item.price,
        scheme_label:   item.schemeLabel ?? null,
        discount_value: item.discountAmount ?? 0,
        line_total:     item.payableAmount,
      })),
    }
  }

  // meta: { placedBy: { id, name, usertype }, orderingFor: { id, name, type } }
  // orderEntityId: client-generated uuid (see CartSummary.submitOrder) that any
  // documents were already uploaded under — becomes this order's actual id.
  const placeOrder = async (cartItems, totals, meta = {}, extraData = null, paymentMethod = null, chequeDetails = null, remarks = null, deliveryAddress = null, orderEntityId = null) => {
    const payload = {
      ...buildOrderPayload(cartItems, totals, extraData, paymentMethod, chequeDetails, remarks, deliveryAddress),
      id:                 orderEntityId,
      placed_by:          meta.placedBy?.id       ?? null,
      placed_by_name:     meta.placedBy?.name     ?? null,
      placed_by_usertype: meta.placedBy?.usertype ?? null,
      ordering_for_id:    meta.orderingFor?.id    ?? null,
      ordering_for_name:  meta.orderingFor?.name  ?? null,
      ordering_for_type:  meta.orderingFor?.type  ?? null,
      division_code:  meta.placedBy?.divisionCode ?? meta.orderingFor?.divisionCode ?? null,
    }
    const order = await ordersApi.place(payload)
    setOrders(curr => [order, ...curr])
    return order
  }

  // Edits a rejected order's full contents and restarts the approval chain.
  const resubmitOrder = async (orderId, cartItems, totals, extraData = null, paymentMethod = null, chequeDetails = null, remarks = null, deliveryAddress = null) => {
    const payload = buildOrderPayload(cartItems, totals, extraData, paymentMethod, chequeDetails, remarks, deliveryAddress)
    const updated = await ordersApi.resubmit(orderId, payload)
    setOrders(curr => curr.map(o => o.id === orderId ? updated : o))
    return updated
  }

  const approveOrder = async (orderId, approver) => {
    const order = orders.find(o => o.id === orderId)
    if (!order) return
    const nextStatus = nextOrderStatus(rules.orderWorkflow, order.approvalStatus)
    if (!nextStatus) return
    const updated = await ordersApi.approve(orderId, {
      approvedBy:       approver.id,
      approvedByName:   approver.name,
      approverUsertype: approver.usertype,
    })
    setOrders(curr => curr.map(o => o.id === orderId ? updated : o))
  }

  const rejectOrder = async (orderId, approver, reason) => {
    const updated = await ordersApi.reject(orderId, {
      approvedBy:       approver.id,
      approvedByName:   approver.name,
      approverUsertype: approver.usertype,
      reason,
    })
    setOrders(curr => curr.map(o => o.id === orderId ? updated : o))
  }

  // Re-fetches a single order — used after a Pay Now action (e.g. generating a
  // payment link) mutates the order server-side outside the usual approve/reject/resubmit flow.
  const refreshOrder = async (orderId) => {
    const updated = await ordersApi.get(orderId)
    setOrders(curr => curr.map(o => o.id === orderId ? updated : o))
    return updated
  }

  return (
    <OrdersContext.Provider value={{ orders, ordersError, reloadOrders, placeOrder, resubmitOrder, approveOrder, rejectOrder, refreshOrder }}>
      {children}
    </OrdersContext.Provider>
  )
}

export function useOrders() {
  const context = useContext(OrdersContext)
  if (!context) throw new Error('useOrders must be used within an OrdersProvider')
  return context
}
