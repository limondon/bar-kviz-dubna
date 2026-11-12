const {defineConfig,devices}=require('@playwright/test');
module.exports=defineConfig({
  // Sequential projects avoid a WebKit worker shutdown hang observed on Windows.
  // Leave room for all three sequential projects and browser teardown in CI.
  testDir:'./tests',testMatch:'**/*.spec.js',outputDir:'./test-results',workers:1,globalTimeout:600000,
  use:{serviceWorkers:'block'},
  projects:[
    {name:'desktop',use:{...devices['Desktop Chrome']}},
    {name:'android',use:{...devices['Pixel 7']}},
    {name:'iphone',use:{...devices['iPhone 13']}}
  ]
});
