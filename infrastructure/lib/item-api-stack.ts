import * as path from 'path';
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  AttributeType,
  BillingMode,
  StreamViewType,
  Table,
} from 'aws-cdk-lib/aws-dynamodb';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';

export interface ItemApiStackProps extends StackProps {
  envName: string;
}

export class ItemApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ItemApiStackProps) {
    super(scope, id, props);

    const isProd = props.envName === 'prod';
    const removalPolicy = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // Single-table design: current item at sk=CURRENT, version snapshots at
    // sk=VERSION#<padded-version>. Audit trail = Query begins_with(sk, "VERSION#").
    // GSI1 supports list-by-subject-and-status sorted by lastModified.
    const table = new Table(this, 'ExamItems', {
      tableName: `ExamItems-${props.envName}`,
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'gsi1pk', type: AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: AttributeType.STRING },
    });

    // All three Lambdas bundle from the same handler module; only the export differs.
    // One function per route gives us tighter IAM and smaller cold-start surface.
    const repoRoot = path.resolve(__dirname, '..', '..');
    const handlerEntry = path.join(repoRoot, 'src', 'handlers', 'items.ts');

    const baseFnProps = {
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(10),
      entry: handlerEntry,
      // Point bundling at the repo's lockfile so esbuild treats the repo root
      // (not infrastructure/) as the project root and can resolve src/handlers.
      depsLockFilePath: path.join(repoRoot, 'pnpm-lock.yaml'),
      environment: {
        DYNAMODB_TABLE_NAME: table.tableName,
        USE_DYNAMODB: 'true',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
      },
    } as const;

    const createFn = new NodejsFunction(this, 'CreateItemFn', {
      ...baseFnProps,
      handler: 'createItem',
    });
    const getFn = new NodejsFunction(this, 'GetItemFn', {
      ...baseFnProps,
      handler: 'getItem',
    });
    const listFn = new NodejsFunction(this, 'ListItemsFn', {
      ...baseFnProps,
      handler: 'listItems',
    });

    table.grantWriteData(createFn);
    table.grantReadData(getFn);
    table.grantReadData(listFn);

    const logRetention = isProd ? RetentionDays.ONE_MONTH : RetentionDays.ONE_WEEK;
    for (const fn of [createFn, getFn, listFn]) {
      new LogGroup(this, `${fn.node.id}LogGroup`, {
        logGroupName: `/aws/lambda/${fn.functionName}`,
        retention: logRetention,
        removalPolicy,
      });
    }

    // HTTP API rather than REST API: lower cost and latency, and we don't need
    // request validation, usage plans, or API keys here.
    const api = new HttpApi(this, 'ItemApi', {
      apiName: `item-api-${props.envName}`,
    });

    api.addRoutes({
      path: '/api/items',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('CreateInt', createFn),
    });
    api.addRoutes({
      path: '/api/items',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('ListInt', listFn),
    });
    api.addRoutes({
      path: '/api/items/{id}',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetInt', getFn),
    });

    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
    new CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
