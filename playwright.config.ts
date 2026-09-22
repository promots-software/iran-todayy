import {defineConfig} from '@playwright/test';
const baseURL=process.env.TEST_BASE_URL;
if(!baseURL||new URL(baseURL).hostname!=='127.0.0.1')throw Error('LOCAL_E2E_ONLY');
export default defineConfig({testDir:'./tests/e2e',testMatch:'**/*.spec.ts',workers:1,retries:0,timeout:180000,expect:{timeout:30000},reporter:[['list'],['json',{outputFile:'.test-tools/e2e-results.json'}]],use:{baseURL,headless:true,channel:process.env.E2E_BROWSER_CHANNEL||'msedge',trace:'off',screenshot:'off'},outputDir:'.test-tools/e2e-output'});
