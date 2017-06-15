
const sg                      = require('sgsg');
const _                       = sg._;
const serverassist            = require('serverassist');
const http                    = require('http');
const fs                      = require('fs');
const path                    = require('path');
const urlLib                  = require('url');
const routes                  = require('./routes/routes');
const MongoClient             = require('mongodb').MongoClient;
const ra                      = require('run-anywhere');
const libBuildNginxConf       = require('./ra-scripts/build-nginx-conf');

const registerAsService       = serverassist.registerAsService;
const registerAsServiceApp    = serverassist.registerAsServiceApp;
const isLocalWorkstation      = serverassist.isLocalWorkstation;

var   ARGV                    = sg.ARGV();
const mongoHost               = serverassist.mongoHost();
const myIp                    = serverassist.myIp();
const buildNginxConf          = ra.contextify(libBuildNginxConf.build);

var   dumpReq;

const appName                 = 'webtier_router';
const port                    = 8401;
//const mount                   = 'xcc/api/v1/dbg-telemetry/';
//const rewrite                 = 'api/v1/dbg-telemetry/';

var servers = {};

const main = function() {

  const fqdnStr = ARGV.fqdn || ARGV.fqdns || '';
  const fqdns   = fqdnStr.split(',');

  if (isLocalWorkstation()) {
    fqdns.unshift('local.mobilewebassist.net');
  }

  return MongoClient.connect(mongoHost, (err, db) => {
    if (err)      { return sg.die(err, `Could not connect to DB ${mongoHost}`); }

    sg.__run([function(next) {
      return routes.addRoutesToServers(db, servers, (err) => {
        if (err) { console.error(`Failed to add servers`); }

        return next();
      });
    }, function(next) {

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

      server.listen(port, myIp, () => {
        console.log(`${appName} running at http://${myIp}:${port}/`);
        console.log('');

        next();
//        registerAsServiceApp(appName, mount, {rewrite});

        registerMyService();
        function registerMyService() {
          setTimeout(registerMyService, 750);
          registerAsService(appName, `http://${myIp}:${port}`, myIp, 4000);
        }
      });

    }], function() {

      return buildNginxConf({fqdns}, function(err, conf) {
        if (err) { return sg.die(err, `Failed build nginx.conf file`); }

        var confFilename = '/tmp/server-assist-nginx.conf';
        return fs.writeFile(confFilename, conf, function(err) {
          if (err) { return sg.die(err, `Failed save nginx.conf /tmp/ file`); }

          const cmd   = path.join(__dirname, 'scripts', 'reload-nginx');
          const args  = [confFilename];

          return sg.exec(cmd, args, (err, exitCode, stdoutChunks, stderrChunks, signal) => {
            if (err)  { console.error(`Failed to (re)start nginx`); }
            console.log(`${cmd}: exit: ${exitCode}, signal: ${signal}`);
            console.log(stderrChunks.join('\n'));
            console.log(stdoutChunks.join('\n'));

          });
        });
      });
    });
  });
};

dumpReq = function(req, res) {
  if (sg.verbosity() >= 3) {
    console.log(req.method, req.url);
    _.each(req.headers, function(value, key) {
      console.log(sg.pad(key, 20), value);
    });
    console.log(sg.inspect(req.bodyJson));
    console.log('--------');
  }
};

if (__filename === process.argv[1]) {
  main();
}


