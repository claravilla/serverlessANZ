import { App, Duration, Stack, StackProps } from "aws-cdk-lib";

import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { AttributeType, Table } from "aws-cdk-lib/aws-dynamodb";
import {
  Effect,
  Policy,
  PolicyDocument,
  PolicyStatement,
} from "aws-cdk-lib/aws-iam";
import { Rule, RuleTargetInput } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import path from "path";

export default class FraudLambdaStack extends Stack {
  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props);

    const { account, region } = this;

    const lambda = new NodejsFunction(this, "serverlessFraudLambda", {
      functionName: "serverless-fraud-lambda",
      runtime: Runtime.NODEJS_18_X,
      timeout: Duration.seconds(10),
      entry: path.join(__dirname, "/../src/fraudService.ts"),
    });

    const orderTable = new Table(this, "fraud-order-table-lambda", {
      tableName: "fraud-order-table-lambda",
      partitionKey: {
        name: "orderNumber",
        type: AttributeType.STRING,
      },
    });

    new Rule(this, "serverlessLambdaRule", {
      ruleName: "serverless-lambda-trigger-rule",
      eventPattern: {
        source: ["service-order"],
        detailType: ["order.created"],
      },
      targets: [
        new LambdaFunction(lambda, {
          event: RuleTargetInput.fromEventPath("$.detail"),
        }),
      ],
    });

    const lambdaPolicy = new Policy(this, "LambdaPolicy", {
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
        ],
      }),
    });

    lambda.role?.attachInlinePolicy(lambdaPolicy);
  }
}
