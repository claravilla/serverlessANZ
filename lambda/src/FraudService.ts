import dotenv from "dotenv";
import { Logger } from "@aws-lambda-powertools/logger";
import { dynamoLookUp, dynamoCreate, putEvent } from "./AwsUtils";
import axios from "axios";
import {
  FraudCheckedEvent,
  FraudEvent,
  FraudRequest,
  FraudResult,
} from "./Types";

dotenv.config();

export const handler = async (event: FraudEvent) => {
  const logger = new Logger();

  //1.  Validate your event

  if (
    !event.orderNumber ||
    !event.countryCode ||
    !event.amount ||
    !event.currency
  ) {
    throw new Error("Order details missing");
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

  // 2. Check if the order exist in Dynamo

  let fraudEvent: FraudCheckedEvent;
  let fraudStatus: string;

  try {
    const dbResult = await dynamoLookUp(orderNumber);

    // 2a. if yes, set the bus event to the stored status and go to step 6

    if (dbResult !== "No record found") {
      const status = dbResult.status.S as unknown;
      fraudStatus = status as string;
      fraudEvent = {
        orderNumber: orderNumber,
        fraudStatusCheck: fraudStatus,
      };
    } else {
      // 2b. if not, proceed with fraud check

      // 3. create request

      const fraudRequest: FraudRequest = {
        orderNumber: orderNumber,
        country: countryCode,
        orderTotal: Number(amount),
        currency: currency,
      };

      // 4. call fraud vendor

      const result = await axios.post(
        process.env.FRAUD_URL as string,
        fraudRequest
      );

      const fraudCheckResult: FraudResult = result.data;

      if (!fraudCheckResult.status) {
        throw new Error("Fraud check could not be performed");
      }

      logger.info("Fraud check call completed");

      fraudStatus = fraudCheckResult.status;

      // 5. Create record in Dynamo

      await dynamoCreate(orderNumber, fraudStatus);

      // 6.a set the bus event

      fraudEvent = {
        orderNumber: orderNumber,
        fraudStatusCheck: fraudStatus,
      };
    }

    // 6. Put event to the bus

    await putEvent(fraudEvent);

    return;
  } catch (error) {
    logger.info(`Something went wrong: ${error}`);
    throw new Error(`Something went wrong: ${error}`);
  }
};
