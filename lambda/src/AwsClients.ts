import {
  DynamoDBClient,
  GetItemCommand,
  GetItemInput,
  PutItemCommand,
  PutItemInput,
} from "@aws-sdk/client-dynamodb";
import {
  EventBridgeClient,
  PutEventsCommand,
  PutEventsRequest,
} from "@aws-sdk/client-eventbridge";
import { FraudCheckedEvent, FraudStatus } from "./Types";

export const clientDynamo = new DynamoDBClient({ region: process.env.REGION });
export const clientEventBridge = new EventBridgeClient({
  region: process.env.REGION,
});

export const dynamoLookUp = async (orderNumber: string) => {
  const input: GetItemInput = {
    TableName: "fraud-order-table-lambda",
    Key: {
      orderNumber: {
        S: orderNumber,
      },
    },
  };
  const command = new GetItemCommand(input);
  try {
    const result = await clientDynamo.send(command);
    if (!result.Item) {
      return "No record found";
    }
    return result.Item;
  } catch (error) {
    throw new Error(`error using dynamo: ${error}`);
  }
};

export const dynamoCreate = async (
  orderNumber: string,
  status: FraudStatus
) => {
  const input: PutItemInput = {
    TableName: "fraud-order-table-lambda",
    Item: {
      orderNumber: {
        S: orderNumber,
      },
      status: {
        S: status,
      },
    },
  };
  const command = new PutItemCommand(input);
  try {
    await clientDynamo.send(command);
  } catch (error) {
    throw new Error(`error using dynamo: ${error}`);
  }
};

export const putEvent = async (event: FraudCheckedEvent) => {
  const input: PutEventsRequest = {
    Entries: [
      {
        Time: new Date(),
        DetailType: "fraud-check",
        Detail: JSON.stringify(event),
        Source: "fraud-check-service",
      },
    ],
  };
  const command = new PutEventsCommand(input);
  try {
    await clientEventBridge.send(command);
  } catch (error) {
    throw new Error(`error putting event to the bus: ${error}`);
  }
};

