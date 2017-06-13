
const sg                  = require('sgsg');
const _                   = sg._;
const Router              = require('routes');
const clusterLib          = require('js-cluster');
const http                = require('http');
const urlLib              = require('url');
var   routes              = require('./routes/routes');

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

var   dumpReq;

var servers = {};
sg.__run([function(next) {
  return routes.addRoutesToServers(servers, (err) => {
    if (err) { console.error(`Failed to add servers`); }

    return next();
  });
}], function() {
  const server = http.createServer((req, res) => {
    return sg.getBody(req, function() {
      dumpReq(req, res);

      const pathname      = urlLib.parse(req.url).pathname;
      var   resPayload    = `Result for ${pathname}`;

      const host          = req.headers.host;
      const serverRoutes  = servers[host] && servers[host].router;

      if (serverRoutes) {
        const route       = serverRoutes.match(pathname);

        if (route && _.isFunction(route.fn)) {
          return route.fn(req, res, route.params, route.splats, route);
        } else {

          // Did not match the route to any handler
          res.statusCode  = 404;
          resPayload      = `404 - Not Found: ${host} / ${pathname}`;
        }

      } else {

        // We do not know that server
        res.statusCode  = 400;
        resPayload      = "400 - Bad Request";
      }

      res.end(resPayload+'\n');
    });
  });

  server.listen(myPort, hostname, () => {
    console.log(`Server running at http://${hostname}:${myPort}/`);
    console.log('');

    registerAsService();
    function registerAsService() {
      setTimeout(registerAsService, 750);
      myServices.registerService('webtier_router', 'http://'+myIp+':'+myPort, myIp, 4000, function(){});
    }
  });
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

