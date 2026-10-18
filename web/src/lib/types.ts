export interface ModifierOption { option: string; priceDelta: number; }
export interface ModifierGroup { id: number; name: string; options: ModifierOption[]; }

export interface MenuItem {
  id: number;
  name: string;
  price: number;
  category: string;
  plu?: string;
  imageUrl?: string;
  stationId: number | null;
  soldOut?: boolean;
  tags?: string;
  modifiers?: ModifierGroup[];
}

export interface Category { id: number; name: string; sortOrder?: number; }
export interface Station { id: number; name: string; color?: string; }

export interface TableRow {
  id: number;
  name: string;
  seats: number;
  status: string; // open | ordered | reserved | ...
  qrToken?: string;
  floor?: string;
}

export interface CartModifier { group: string; option: string; priceDelta: number; }
export interface CartLine {
  menuItemId: number;
  name: string;
  basePrice: number;
  qty: number;
  modifiers: CartModifier[];
  notes: string;
  stationId: number | null;
  lineTotal: number;
}

export interface OrderItem {
  menuItemId: number;
  name: string;
  basePrice: number;
  qty: number;
  modifiers: CartModifier[];
  notes: string;
  stationId: number | null;
  stationName?: string;
  lineTotal: number;
  status: string; // pending | ready | served
}

export interface DiscountInfo {
  type?: string;      // percent | fixed
  value?: number;
  amount?: number;    // the actual money taken off
  reason?: string;
  approvedBy?: string;
}

export interface OrderPayment {
  method: string;            // cash | card | online | wallet | giftcard
  type?: string;             // payment | refund
  amount: number;            // negative for refunds
  code?: string;             // gift card code (method = giftcard)
  reason?: string;
  byStaffName?: string;
  approvedBy?: string;
  paidAt?: string;
}

export interface Order {
  id: number;
  displayNum: string;
  isMergedBill?: boolean;
  orderIds?: number[];
  memberOrders?: { id: number; displayNum: string; total: number; amountPaid: number }[];
  orderType: string;
  tableId: number | null;
  tableName: string;
  staffName?: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  note?: string;
  items: OrderItem[];
  subtotal: number;
  // backend stores this as a {type,value,amount} object (or null); older code
  // paths may still hand back a plain number — use discountAmount() to read it.
  discount?: number | DiscountInfo | null;
  serviceCharge: number;
  vat: number;
  total: number;
  grandTotal?: number;
  amountPaid?: number;
  payments?: OrderPayment[];
  paidAt?: string;
  status: string;        // pending | preparing | ready | served | completed | voided
  paymentStatus: string; // unpaid | partial | paid | refunded
  priority: string;      // normal | high
  kitchenTag?: string;
  createdAt?: string;
  readyAt?: string;
  startedAt?: string | null;
  dispatchedAt?: string | null;
  staffId?: number | null;
  // kitchen -> server hand-off
  pickupById?: number | null;
  pickupByName?: string;
  pickupAt?: string | null;
  servedById?: number | null;
  servedByName?: string;
  source?: string;
  voidData?: { reason?: string; byStaffName?: string; at?: string };
}
