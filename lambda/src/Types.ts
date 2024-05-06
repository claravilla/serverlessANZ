export interface FraudEvent {
  orderNumber: string;
  countryCode: string;
  amount: number;
  currency: string;
}

export enum FraudStatus {
  APPROVED = "approved",
  REJECTED = "rejected",
}

export interface FraudResult {
  status: FraudStatus;
}

export interface FraudCheckedEvent {
  orderNumber: string;
  fraudStatusCheck: FraudStatus;
}

