#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { ItemApiStack } from '../lib/item-api-stack';

const app = new App();
const envName = (app.node.tryGetContext('env') as string | undefined) ?? 'dev';

new ItemApiStack(app, `ItemApiStack-${envName}`, {
  envName,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
});
