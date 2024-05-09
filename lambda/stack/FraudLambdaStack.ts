import dotenv from 'dotenv'
import { App, CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
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

export default class FraudLambdaStack extends Stack {
  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props);

    dotenv.config()

    const { account, region } = this;

    const lambda = new NodejsFunction(this, "serverlessFraudLambda", {
      functionName: "serverless-fraud-lambda",
      runtime: Runtime.NODEJS_18_X,
      timeout: Duration.seconds(10),
      entry: path.join(__dirname, "/../src/fraudService.ts"),
    });

    const apiIntegration = new HttpLambdaIntegration(
      "serverless-fraud-lambda-api-integration",
      lambda
    );

    const api = new HttpApi(this, "ServerlessFraudLambdaAPI");

    api.addRoutes({
      path: "/",
      methods: [HttpMethod.POST],
      integration: apiIntegration,
    });

    const orderTable = new Table(this, "fraud-order-table-lambda", {
      tableName: "fraud-order-table-lambda",
      partitionKey: {
        name: "orderNumber",
        type: AttributeType.STRING,
      },
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

    new CfnOutput(this, "apiURL", {
      value: api.url as string,
    });
  }
}


