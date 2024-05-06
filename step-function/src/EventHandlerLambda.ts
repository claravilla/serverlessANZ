import { FraudEvent } from "./Types";

export const handler = async (event: any) => {
  const orderDetails: FraudEvent = event.body;

  if (
    !orderDetails.orderNumber ||
    !orderDetails.countryCode ||
    !orderDetails.amount ||
    !orderDetails.currency
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
    amount: number;
    currency: string;
  } = orderDetails;

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
