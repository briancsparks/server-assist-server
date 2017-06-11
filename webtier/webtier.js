
const sg                  = require('sgsg');
const _                   = sg._;
const Router              = require('routes');
const clusterLib          = require('js-cluster');
const http                = require('http');

var   router              = Router();
var   ARGV                = sg.ARGV();
var   ServiceList         = clusterLib.ServiceList;

const hostname            = '127.0.0.1';
const port2               = 8212;

const myPort              = 8401;
const myIp                = process.env.SERVERASSIST_MY_IP          || '127.0.0.1';
const utilIp              = process.env.SERVERASSIST_UTIL_HOSTNAME  || 'localhost';
const myColor             = process.env.SERVERASSIST_COLOR          || 'green';
const myStack             = process.env.SERVERASSIST_STACK          || 'test';

var   myServices          = new ServiceList(['serverassist', myColor, myStack].join('-'), utilIp);

var dumpReq;

const server = http.createServer((req, res) => {
  return sg.getBody(req, function() {
    dumpReq(req, res);

    var fwd   = _.rest(req.url.split('/')).join('/');
    var host  = '127.0.0.1';
    var redir = `/rpxi/${req.method}/${host}:${port2}/${fwd}`;

    console.error(`${req.method}: ${fwd} ->> ${host}:${port2}`);

    res.statusCode = 200;
    res.setHeader('X-Accel-Redirect', redir);
    res.end('');
  });
});

server.listen(myPort, hostname, () => {
  console.log(`Server running at http://${hostname}:${myPort}/`);

  registerAsService();
  function registerAsService() {
    myServices.registerService('webtier_router', 'http://'+myIp+':'+myPort, myIp, 4000, function(){});
    setTimeout(registerAsService, 750);
  }
});

dumpReq = function(req, res) {
  if (sg.verbosity() >= 0) {
    console.log(req.method, req.url);
    _.each(req.headers, function(value, key) {
      console.log(sg.pad(key, 20), value);
    });
    console.log(sg.inspect(req.bodyJson));
    console.log('--------');
  }
};

