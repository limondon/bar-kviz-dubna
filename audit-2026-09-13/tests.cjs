const fs=require('fs'),path=require('path'),Module=require('module');
const base='C:/Users/Андрей/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const original=Module._resolveFilename;Module._resolveFilename=function(r,...a){return original.call(this,r==='@playwright/test'?base+'/test.js':r,...a)};
const {test,expect}=require(base+'/test.js');
test.use({launchOptions:{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}});
require('../tests/item-price.spec.js');require('../tests/guest-static.spec.js');
