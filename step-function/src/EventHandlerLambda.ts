import { FraudEvent } from "./Types";

export const handler = async (event: FraudEvent) => {
  if (
    !event.orderNumber ||
    !event.countryCode ||
    !event.amount ||
    !event.currency
  ) {
    return {
      statusCode: 400,
      response: "Missing mandatory details",
    };
  }
  const {
    orderNumber,
    countryCode,
    amount,
    currency,
  }: {
    orderNumber: string;
    countryCode: string;
    amount: string;
    currency: string;
  } = event;

  return {
    statusCode: 200,
    response: {
      orderNumber: orderNumber,
      country: countryCode,
      orderTotal: Number(amount),
      currency: currency,
    },
  };
};
