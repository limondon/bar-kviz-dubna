const {defineConfig,devices}=require('@playwright/test');
module.exports=defineConfig({testDir:'./tests',testMatch:'mobile.spec.js',outputDir:'./test-results-mobile',workers:1,use:{serviceWorkers:'block'},projects:[
  {name:'android-chromium',use:{...devices['Pixel 7'],browserName:'chromium',launchOptions:process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}}},
  {name:'iphone-webkit',use:{...devices['iPhone 13'],browserName:'webkit'}}
]});
