import {
  App,
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
  Fail,
  JsonPath,
  LogLevel,
  Pass,
  StateMachine,
  StateMachineType,
  TaskInput,
} from "aws-cdk-lib/aws-stepfunctions";
import {
  Authorization,
  Connection,
  Rule,
  RuleTargetInput,
} from "aws-cdk-lib/aws-events";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { SfnStateMachine } from "aws-cdk-lib/aws-events-targets";

export default class FraudStepFunctionStack extends Stack {
  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props);

    const { account, region } = this;

    // const { FRAUD_URL: fraudUrl } = process.env;
    const fraudUrl = "https://oondk3w0w1.execute-api.ap-southeast-2.amazonaws.com/"


    if (fraudUrl === undefined) {
      throw new Error("The fraud url is undefinded");
    }

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

    const eventHandlerTask = new LambdaInvoke(this, "EventHandler", {
      lambdaFunction: eventHandlerLambda,
      resultSelector: {
        "payload.$": "$.Payload",
      },
      resultPath: "$.stateData.eventHandlerTask",
    });

    const invalidEventTask = new Fail(this, "InvalidEvent", {
      errorPath: JsonPath.stringAt(
        "$.stateData.eventHandlerTask.payload.response"
      ),
    });

    const checkOrderFraudStatusTask = new DynamoGetItem(this, "CheckOrderFraudStatus", {
      key: {
        orderNumber: DynamoAttributeValue.fromString(
          JsonPath.stringAt(
            "$.stateData.eventHandlerTask.payload.response.orderNumber"
          )
        ),
      },
      table: orderTable,
      resultPath: "$.stateData.checkOrderFraudStatusTask",
    }).addRetry({
      interval: Duration.seconds(2),
      backoffRate: 2,
      errors: [
        "ServiceUnavailable",
        "InternalServerError",
        "ThrottlingException",
      ],
    });

    const putEventTask = new EventBridgePutEvents(this, "PutEvent", {
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

    const storeFraudCheckTask = new DynamoPutItem(this, "StoreFraudCheck", {
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
      resultPath: "$.stateData.storeFraudCheckTask",
    }).addRetry({
      interval: Duration.seconds(2),
      backoffRate: 2,
      errors: [
        "ServiceUnavailable",
        "InternalServerError",
        "ThrottlingException",
      ],
    }).next(putEventTask)


    const fraudCheckFailedTask = new Fail (this, "FraudCheckFailed", {
      cause: "Fraud check did not return a status"
    });

    const hasFraudCheckCompletedSuccessfully = new Choice(
      this,
      "hasFraudCheckCompletedSuccessfully"
    )
      .when(
        Condition.isNotPresent(
          "$.stateData.callFraudServiceTask.payload.status"
        ),
        fraudCheckFailedTask
      )
      .otherwise(storeFraudCheckTask);

    const callFraudServiceTask = new CustomState(this, "callFraudService", {
      stateJson: {
        Type: "Task",
        Resource: "arn:aws:states:::http:invoke",
        Parameters: {
          ApiEndpoint: fraudUrl,
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

    const setEventForExistingOrdersTask = new Pass(
      this,
      "setEventForExistingOrders",
      {
        parameters: {
          status: JsonPath.stringAt(
            "$.stateData.checkOrderFraudStatusTask.Item.status.S"
          ),
        },
        resultPath: "$.stateData.callFraudServiceTask.payload",
      }
    ).next(putEventTask);

    const isOrderAlreadyChecked = new Choice(this, "isOrderAlreadyChecked")
      .when(
        Condition.isNotPresent("$.stateData.checkOrderFraudStatusTask.Item"),
        callFraudServiceTask
      )
      .otherwise(setEventForExistingOrdersTask);

    const validEventBranch = checkOrderFraudStatusTask.next(isOrderAlreadyChecked);

    const isEventValid = new Choice(this, "isEventValid")
      .when(
        Condition.numberEquals(
          "$.stateData.eventHandlerTask.payload.statusCode",
          200
        ),
        validEventBranch
      )
      .otherwise(invalidEventTask);

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

    //--- Event Bridge Rule ---

    new Rule(this, "serverlessStateMachineRule", {
      ruleName: "serverless-state-machine-trigger-rule",
      eventPattern: {
        source: ["service-order"],
        detailType: ["order.created"],
      },
      targets: [
        new SfnStateMachine(stateMachine, {
          input: RuleTargetInput.fromEventPath("$.detail"),
        }),
      ],
    });

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
  }
}
