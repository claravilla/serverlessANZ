export interface FraudEvent {
  orderNumber: string;
  countryCode: string;
  amount: string;
  currency: string;
}

export interface FraudRequest {
  orderNumber: string;
  country: string
  orderTotal: number;
  currency: string;
}

export interface FraudResult {
  status: string;
}

export interface FraudCheckedEvent {
  orderNumber: string;
  fraudStatusCheck: string;
}

