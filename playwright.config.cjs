const {defineConfig,devices}=require('@playwright/test');
module.exports=defineConfig({
  // Sequential projects avoid a WebKit worker shutdown hang observed on Windows.
  testDir:'./tests',testMatch:'**/*.spec.js',outputDir:'./test-results',workers:1,globalTimeout:120000,
  use:{serviceWorkers:'block'},
  projects:[
    {name:'desktop',use:{...devices['Desktop Chrome']}},
    {name:'android',use:{...devices['Pixel 7']}},
    {name:'iphone',use:{...devices['iPhone 13']}}
  ]
});
