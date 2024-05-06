import {
  App,
  CfnOutput,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { AttributeType, Table } from "aws-cdk-lib/aws-dynamodb";
import path from "path";
import {
  Effect,
  Policy,
  PolicyDocument,
  PolicyStatement,
} from "aws-cdk-lib/aws-iam";
import {
  DynamoAttributeValue,
  DynamoGetItem,
  DynamoPutItem,
  EventBridgePutEvents,
  LambdaInvoke,
} from "aws-cdk-lib/aws-stepfunctions-tasks";
import {
  Choice,
  Condition,
  CustomState,
  DefinitionBody,
  JsonPath,
  LogLevel,
  Pass,
  StateMachine,
  StateMachineType,
  TaskInput,
} from "aws-cdk-lib/aws-stepfunctions";
import { RestApi, StepFunctionsIntegration } from "aws-cdk-lib/aws-apigateway";
import { Authorization, Connection } from "aws-cdk-lib/aws-events";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";

export default class FraudStepFunctionStack extends Stack {
  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props);

    const { account, region } = this;

    console.log(process.env.FRAUD_URL);

    const { FRAUD_URL: fraudUrl } = process.env;
    console.log(fraudUrl);

    // if (fraudUrl === undefined) {
    //   throw new Error("The fraud url is undefinded");
    // }

    // ----- Lambda ------

    const eventHandlerLambda = new NodejsFunction(
      this,
      "serverlessValidateLambda",
      {
        functionName: "serverless-validate-lambda",
        runtime: Runtime.NODEJS_18_X,
        timeout: Duration.seconds(10),
        entry: path.join(__dirname, "/../src/EventHandlerLambda.ts"),
      }
    );

    // ----- Dynamo table -----

    const orderTable = new Table(this, "FraudOrderTableStepFunction", {
      tableName: "fraud-order-table-step-function",
      partitionKey: {
        name: "orderNumber",
        type: AttributeType.STRING,
      },
    });

    // ---- External API call connection ----

    const fraudAPIConnection = new Connection(this, "FraudAPIConnection", {
      authorization: Authorization.basic(
        "FakeUser",
        new SecretValue("secret password")
      ),
    });

    // --- Log group for State Machine ----

    const sfLogGroup = new LogGroup(this, "sfLogGroup", {
      logGroupName: "fraud-step-function-logs",
      retention: RetentionDays.ONE_DAY,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ----- Step Function tasks ----

    const eventHandlerTask = new LambdaInvoke(this, "EventHandlerTask", {
      lambdaFunction: eventHandlerLambda,
      resultSelector: {
        "payload.$": "$.Payload",
      },
      resultPath: "$.stateData.eventHandlerTask",
    });

    const invalidEvent = new Pass(this, "InvalidEvent", {
      parameters: {
        status: 400,
        response: JsonPath.stringAt(
          "$.stateData.eventHandlerTask.payload.response"
        ),
      },
    });

    const fraudCheckResponse = new Pass(this, "FraudCheckResponse", {
      parameters: {
        orderNumber: JsonPath.stringAt(
          "$.stateData.eventHandlerTask.payload.response.orderNumber"
        ),
        status: JsonPath.stringAt(
          "$.stateData.callFraudServiceTask.payload.status"
        ),
      },
    });

    const dynamoCheckTask = new DynamoGetItem(this, "GetItem", {
      key: {
        orderNumber: DynamoAttributeValue.fromString(
          JsonPath.stringAt(
            "$.stateData.eventHandlerTask.payload.response.orderNumber"
          )
        ),
      },
      table: orderTable,
      resultPath: "$.stateData.dynamoCheckTask",
    }).addRetry({
      interval: Duration.seconds(2),
      backoffRate: 2,
      errors: [
        "ServiceUnavailable",
        "InternalServerError",
        "ThrottlingException",
      ],
    });

    const dynamoCreateTask = new DynamoPutItem(this, "PutItem", {
      item: {
        orderNumber: DynamoAttributeValue.fromString(
          JsonPath.stringAt(
            "$.stateData.eventHandlerTask.payload.response.orderNumber"
          )
        ),
        status: DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.stateData.callFraudServiceTask.payload.status")
        ),
      },
      table: orderTable,
      resultPath: "$.stateData.dynamoCreateTask",
    }).addRetry({
      interval: Duration.seconds(2),
      backoffRate: 2,
      errors: [
        "ServiceUnavailable",
        "InternalServerError",
        "ThrottlingException",
      ],
    });

    const putEvent = new EventBridgePutEvents(this, "PutEvent", {
      entries: [
        {
          detail: TaskInput.fromObject({
            fraudResult: {
              orderNumber: JsonPath.stringAt(
                "$.stateData.eventHandlerTask.payload.response.orderNumber"
              ),
              status: JsonPath.stringAt(
                "$.stateData.callFraudServiceTask.payload.status"
              ),
            },
          }),
          detailType: "FraudCheckResult",
          source: "fraud.check",
        },
      ],
      resultPath: "$.stateData.PutEventTask",
    }).addRetry({
      interval: Duration.seconds(2),
      backoffRate: 2,
      errors: ["InternalFailure", "ServiceUnavailable", "ThrottlingException"],
    });

    const newOrderBranchFraudCheckCompleted = dynamoCreateTask
      .next(putEvent)
      .next(fraudCheckResponse);

    const fraudCheckFailed = new Pass(this, "FraudCheckFailed", {
      parameters: {
        response: "Fraud check could not be performed",
      },
    });

    const hasFraudCheckCompletedSuccessfully = new Choice(
      this,
      "hasFraudCheckCompletedSuccessfully"
    )
      .when(
        Condition.isNotPresent(
          "$.stateData.callFraudServiceTask.payload.status"
        ),
        fraudCheckFailed
      )
      .otherwise(newOrderBranchFraudCheckCompleted);

    const callFraudServiceTask = new CustomState(this, "callFraudServiceTask", {
      stateJson: {
        Type: "Task",
        Resource: "arn:aws:states:::http:invoke",
        Parameters: {
          ApiEndpoint:
            "https://oondk3w0w1.execute-api.ap-southeast-2.amazonaws.com/",
          Authentication: {
            ConnectionArn: fraudAPIConnection.connectionArn,
          },
          Method: "POST",
          RequestBody: {
            "orderNumber.$": JsonPath.stringAt(
              "$.stateData.eventHandlerTask.payload.response.orderNumber"
            ),
            "country.$": JsonPath.stringAt(
              "$.stateData.eventHandlerTask.payload.response.country"
            ),
            "orderTotal.$": JsonPath.numberAt(
              "$.stateData.eventHandlerTask.payload.response.orderTotal"
            ),
            "currency.$": JsonPath.stringAt(
              "$.stateData.eventHandlerTask.payload.response.currency"
            ),
          },
        },
        ResultSelector: {
          "payload.$": "$.ResponseBody",
        },
        ResultPath: "$.stateData.callFraudServiceTask",
      },
    })
      .addRetry({
        interval: Duration.seconds(1),
        backoffRate: 2,
        errors: ["ServiceUnavailable"],
      })
      .next(hasFraudCheckCompletedSuccessfully);

    const setEventForExistingOrders = new Pass(
      this,
      "setEventForExistingOrders",
      {
        parameters: {
          status: JsonPath.stringAt(
            "$.stateData.dynamoCheckTask.Item.status.S"
          ),
        },
        resultPath: "$.stateData.callFraudServiceTask.payload",
      }
    ).next(putEvent);

    const isOrderAlreadyChecked = new Choice(this, "isOrderAlreadyChecked")
      .when(
        Condition.isNotPresent("$.stateData.dynamoCheckTask.Item"),
        callFraudServiceTask
      )
      .otherwise(setEventForExistingOrders);

    const validEventBranch = dynamoCheckTask.next(isOrderAlreadyChecked);

    const isEventValid = new Choice(this, "isEventValid")
      .when(
        Condition.numberEquals(
          "$.stateData.eventHandlerTask.payload.statusCode",
          200
        ),
        validEventBranch
      )
      .otherwise(invalidEvent);

    const stateMachineStart = eventHandlerTask.next(isEventValid);

    // --- State Machine ----

    const stateMachine = new StateMachine(this, "FraudStateMachine", {
      definitionBody: DefinitionBody.fromChainable(stateMachineStart),
      stateMachineType: StateMachineType.EXPRESS,
      logs: {
        destination: sfLogGroup,
        level: LogLevel.ALL,
        includeExecutionData: true,
      },
    });

    // ---- API ----

    const api = new RestApi(this, "ServerlessFraudStepFunctionApi", {
      restApiName: "serverless-fraud-step-function-api",
    });
    api.root.addMethod(
      "POST",
      StepFunctionsIntegration.startExecution(stateMachine)
    );

    // ---- State Machine Policy ----

    const stateMachinePolicy = new Policy(this, "StateMachinePolicy", {
      document: new PolicyDocument({
        statements: [
          new PolicyStatement({
            actions: ["dynamodb:GetItem", "dynamodb:PutItem"],
            resources: [orderTable.tableArn],
            effect: Effect.ALLOW,
          }),
          new PolicyStatement({
            actions: ["events:PutEvents"],
            resources: [
              `arn:aws:events:${region}:${account}:event-bus/default`,
            ],
            effect: Effect.ALLOW,
          }),
          new PolicyStatement({
            actions: ["events:RetrieveConnectionCredentials"],
            resources: [fraudAPIConnection.connectionArn],
          }),
          new PolicyStatement({
            actions: [
              "secretsmanager:GetSecretValue",
              "secretsmanager:DescribeSecret",
            ],
            resources: [
              "arn:aws:secretsmanager:*:*:secret:events!connection/*",
            ],
          }),
          new PolicyStatement({
            actions: ["states:InvokeHTTPEndpoint"],
            resources: [stateMachine.stateMachineArn],
            effect: Effect.ALLOW,
            conditions: {
              StringEquals: {
                "states:HTTPMethod": "POST",
              },
              StringLike: {
                "states:HTTPEndpoint":
                  "https://oondk3w0w1.execute-api.ap-southeast-2.amazonaws.com/*",
              },
            },
          }),
        ],
      }),
    });

    stateMachine.role.attachInlinePolicy(stateMachinePolicy);

    new CfnOutput(this, "apiURL", {
      value: api.url as string,
    });
  }
}