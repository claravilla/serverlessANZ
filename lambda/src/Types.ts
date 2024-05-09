export interface FraudEvent {
  orderNumber: string;
  countryCode: string;
  amount: number;
  currency: string;
}

export interface FraudResult {
  status: string;
}

export interface FraudCheckedEvent {
  orderNumber: string;
  fraudStatusCheck: string;
}

